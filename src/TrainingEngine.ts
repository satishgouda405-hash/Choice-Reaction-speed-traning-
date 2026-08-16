import { TrainingConfig, Trial, MovementEvent, SessionResult } from '../types';
import { StorageManager } from '../storage/StorageManager';

export type EngineStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'FINISHED';

export interface EngineState {
  status: EngineStatus;
  currentTrial: Trial | null;
  score: number;
  accuracy: number;
  trialCount: number;
  correctCount: number;
  incorrectCount: number;
  timeoutCount: number;
  falseStartCount: number;
  noGoErrorCount: number;
  medianReactionMs: number;
  bestReactionMs: number;
  currentStreak: number;
  timeRemainingSeconds: number;
  difficulty: number;
}

export class TrainingEngine {
  private config: TrainingConfig;
  private status: EngineStatus = 'IDLE';
  private currentTrial: Trial | null = null;
  private trials: Trial[] = [];
  private onStateChange: (state: EngineState) => void;

  private score: number = 0;
  private correctCount: number = 0;
  private incorrectCount: number = 0;
  private timeoutCount: number = 0;
  private falseStartCount: number = 0;
  private noGoErrorCount: number = 0;
  private currentStreak: number = 0;
  private reactionTimesMs: number[] = [];

  private sessionTimer: any = null;
  private signalTimer: any = null;
  private responseTimeoutTimer: any = null;
  private timeRemaining: number = 0;

  constructor(config: TrainingConfig, onStateChange: (state: EngineState) => void) {
    this.config = config;
    this.onStateChange = onStateChange;
    this.timeRemaining = config.sessionDurationSeconds;
  }

  public configure(config: TrainingConfig): void {
    this.config = config;
    this.timeRemaining = config.sessionDurationSeconds;
    this.emitState();
  }

  public startSession(): void {
    this.reset();
    this.status = 'RUNNING';
    this.timeRemaining = this.config.sessionDurationSeconds;

    if (this.config.sessionType === 'TIME') {
      this.sessionTimer = setInterval(() => {
        this.timeRemaining--;
        if (this.timeRemaining <= 0) {
          this.finishSession();
        } else {
          this.emitState();
        }
      }, 1000);
    }

    this.scheduleNextTrial();
  }

  public stopSession(): void {
    this.finishSession();
  }

  public reset(): void {
    this.clearTimers();
    this.status = 'IDLE';
    this.currentTrial = null;
    this.trials = [];
    this.score = 0;
    this.correctCount = 0;
    this.incorrectCount = 0;
    this.timeoutCount = 0;
    this.falseStartCount = 0;
    this.noGoErrorCount = 0;
    this.currentStreak = 0;
    this.reactionTimesMs = [];
    this.timeRemaining = this.config.sessionDurationSeconds;
    this.emitState();
  }

  public processMovement(event: MovementEvent): void {
    if (this.status !== 'RUNNING') return;

    if (!this.currentTrial) {
      this.falseStartCount++;
      this.score = Math.max(0, this.score - 50);
      this.emitState();
      return;
    }

    const reactionTime = event.timestamp - this.currentTrial.signalTimestamp;
    const isCorrect = event.type === this.currentTrial.expectedAction;

    if (isCorrect) {
      this.correctCount++;
      this.currentStreak++;
      this.reactionTimesMs.push(reactionTime);
      this.score += Math.max(10, Math.round(10000 / reactionTime) + this.currentStreak * 10);
    } else {
      this.incorrectCount++;
      this.currentStreak = 0;
      if (this.currentTrial.expectedAction === 'NO_ACTION') {
        this.noGoErrorCount++;
      }
    }

    this.clearResponseTimeout();
    this.currentTrial = null;
    this.emitState();

    if (this.config.sessionType === 'TRIALS' && this.trials.length >= this.config.trialCount) {
      this.finishSession();
    } else {
      this.scheduleNextTrial();
    }
  }

  private scheduleNextTrial(): void {
    const delay = Math.floor(Math.random() * 2000) + 1000;
    this.signalTimer = setTimeout(() => {
      this.startTrial();
    }, delay);
  }

  private startTrial(): void {
    const actions: Array<'JUMP' | 'LEFT' | 'RIGHT' | 'CROUCH'> = ['JUMP', 'LEFT', 'RIGHT', 'CROUCH'];
    const chosenAction = actions[Math.floor(Math.random() * actions.length)];

    this.currentTrial = {
      id: Math.random().toString(36).substring(7),
      signal: {
        type: 'COLOR',
        text: chosenAction,
        color: chosenAction === 'JUMP' ? '#22c55e' : chosenAction === 'CROUCH' ? '#f59e0b' : chosenAction === 'LEFT' ? '#3b82f6' : '#a855f7'
      },
      expectedAction: chosenAction,
      signalTimestamp: performance.now(),
      trialType: 'STANDARD'
    };

    this.trials.push(this.currentTrial);
    this.emitState();

    this.responseTimeoutTimer = setTimeout(() => {
      if (this.currentTrial) {
        this.timeoutCount++;
        this.currentStreak = 0;
        this.currentTrial = null;
        this.emitState();
        this.scheduleNextTrial();
      }
    }, 2000);
  }

  private finishSession(): void {
    this.clearTimers();
    this.status = 'FINISHED';

    const result: SessionResult = {
      id: Math.random().toString(36).substring(7),
      date: new Date().toISOString(),
      mode: this.config.mode,
      score: this.score,
      accuracy: this.getAccuracy(),
      medianReactionMs: this.getMedianReaction(),
      bestReactionMs: this.getBestReaction(),
      totalTrials: this.trials.length,
      correctCount: this.correctCount,
      incorrectCount: this.incorrectCount,
      timeoutCount: this.timeoutCount,
      falseStartCount: this.falseStartCount,
      noGoErrorCount: this.noGoErrorCount,
      difficulty: this.config.difficulty
    };

    StorageManager.saveSession(result);
    this.emitState();
  }

  private clearTimers(): void {
    if (this.sessionTimer) clearInterval(this.sessionTimer);
    if (this.signalTimer) clearTimeout(this.signalTimer);
    this.clearResponseTimeout();
  }

  private clearResponseTimeout(): void {
    if (this.responseTimeoutTimer) clearTimeout(this.responseTimeoutTimer);
  }

  private getAccuracy(): number {
    const total = this.correctCount + this.incorrectCount + this.timeoutCount;
    return total === 0 ? 100 : (this.correctCount / total) * 100;
  }

  private getMedianReaction(): number {
    if (this.reactionTimesMs.length === 0) return 0;
    const sorted = [...this.reactionTimesMs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return Math.round(sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  }

  private getBestReaction(): number {
    if (this.reactionTimesMs.length === 0) return 0;
    return Math.round(Math.min(...this.reactionTimesMs));
  }

  public getState(): EngineState {
    return {
      status: this.status,
      currentTrial: this.currentTrial,
      score: this.score,
      accuracy: this.getAccuracy(),
      trialCount: this.trials.length,
      correctCount: this.correctCount,
      incorrectCount: this.incorrectCount,
      timeoutCount: this.timeoutCount,
      falseStartCount: this.falseStartCount,
      noGoErrorCount: this.noGoErrorCount,
      medianReactionMs: this.getMedianReaction(),
      bestReactionMs: this.getBestReaction(),
      currentStreak: this.currentStreak,
      timeRemainingSeconds: this.timeRemaining,
      difficulty: this.config.difficulty
    };
  }

  private emitState(): void {
    this.onStateChange(this.getState());
  }

  public destroy(): void {
    this.clearTimers();
  }
}
