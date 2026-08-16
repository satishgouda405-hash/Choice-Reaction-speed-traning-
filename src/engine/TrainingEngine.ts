import type {
  SessionConfig, Trial, Signal, Action, TrainingMode,
  DifficultyLevel, MovementEvent, SessionResult, RuleType
} from "../types";
import { RandomEngine } from "../utils/random";
import { uid, median, mean, stdDev, clamp } from "../utils/helpers";
import { AudioEngine } from "../audio/AudioEngine";

export type EngineState =
  | "idle"
  | "countdown"
  | "waiting"
  | "signal"
  | "response_window"
  | "feedback"
  | "finished";

export interface EngineCallbacks {
  onStateChange: (state: EngineState) => void;
  onSignal: (signal: Signal, expected: Action) => void;
  onFeedback: (trial: Trial) => void;
  onSessionEnd: (result: SessionResult) => void;
  onCountdown: (n: number) => void;
  onMovementEvent?: (event: MovementEvent) => void;
  onStatsUpdate?: (stats: LiveStats) => void;
}

export interface LiveStats {
  totalTrials: number;
  correct: number;
  incorrect: number;
  timeouts: number;
  falseStarts: number;
  noGoErrors: number;
  currentStreak: number;
  bestStreak: number;
  score: number;
  accuracy: number;
  medianReaction: number;
  difficulty: number;
  timeElapsed: number;
}

const DIFFICULTY_CONFIG: Record<DifficultyLevel, { minDelay: number; maxDelay: number; responseWindow: number; noGoRatio: number; fakeoutRatio: number }> = {
  BEGINNER: { minDelay: 1500, maxDelay: 3500, responseWindow: 2000, noGoRatio: 0.1, fakeoutRatio: 0 },
  INTERMEDIATE: { minDelay: 800, maxDelay: 2500, responseWindow: 1800, noGoRatio: 0.15, fakeoutRatio: 0.05 },
  ADVANCED: { minDelay: 400, maxDelay: 1800, responseWindow: 1500, noGoRatio: 0.2, fakeoutRatio: 0.1 },
  EXPERT: { minDelay: 200, maxDelay: 1200, responseWindow: 1200, noGoRatio: 0.25, fakeoutRatio: 0.15 },
  EXTREME: { minDelay: 100, maxDelay: 900, responseWindow: 1000, noGoRatio: 0.3, fakeoutRatio: 0.2 },
};

const COLOR_MAP: Record<string, Action> = {
  RED: "JUMP", BLUE: "LEFT", GREEN: "RIGHT", YELLOW: "CROUCH"
};
const ARROW_MAP: Record<string, Action> = {
  "←": "LEFT", "→": "RIGHT", "↑": "JUMP", "↓": "CROUCH"
};
const AUDIO_MAP: Record<string, Action> = {
  "BEEP_1": "LEFT", "BEEP_2": "RIGHT", "BEEP_3": "JUMP", "BEEP_4": "CROUCH"
};

export class TrainingEngine {
  private config: SessionConfig;
  private callbacks: EngineCallbacks;
  private audio: AudioEngine;
  private random: RandomEngine;
  private state: EngineState = "idle";
  private trials: Trial[] = [];
  private currentTrial: Trial | null = null;
  private signalStartTime = 0;
  private responseWindowTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionStartTime = 0;
  private sessionTimer: ReturnType<typeof setInterval> | null = null;
  private timeElapsed = 0;
  private currentStreak = 0;
  private bestStreak = 0;
  private difficultyLevel = 1;
  private rollingAccuracy: number[] = [];
  private rollingReaction: number[] = [];
  private falseStartCount = 0;
  private anticipationCount = 0;
  private lastSignalTime = 0;
  private memorySequence: Action[] = [];
  private memoryIndex = 0;
  private sequenceSignals: Signal[] = [];
  private isAudioOnly = false;
  private rule: RuleType = "COLOR";
  private commandPool: Action[] = ["JUMP", "LEFT", "RIGHT", "CROUCH"];

  constructor(config: SessionConfig, callbacks: EngineCallbacks, audio: AudioEngine) {
    this.config = config;
    this.callbacks = callbacks;
    this.audio = audio;
    this.random = new RandomEngine();
    this.difficultyLevel = this.difficultyToNumber(config.difficulty);
    this.rule = config.rule ?? "COLOR";
    this.commandPool = config.commands.length > 0 ? config.commands : ["JUMP", "LEFT", "RIGHT", "CROUCH"];
    this.isAudioOnly = config.mode === "AUDIO_REACTION";
  }

  start(): void {
    this.state = "countdown";
    this.callbacks.onStateChange("countdown");
    this.runCountdown(3);
  }

  private runCountdown(n: number): void {
    if (n > 0) {
      this.audio.playCountdown();
      this.callbacks.onCountdown(n);
      setTimeout(() => this.runCountdown(n - 1), 800);
    } else {
      this.audio.playStart();
      this.sessionStartTime = performance.now();
      this.state = "waiting";
      this.callbacks.onStateChange("waiting");
      this.startSessionTimer();
      this.scheduleNext();
    }
  }

  private startSessionTimer(): void {
    this.sessionTimer = setInterval(() => {
      this.timeElapsed = Math.floor((performance.now() - this.sessionStartTime) / 1000);
      if (this.config.durationMinutes > 0 && this.timeElapsed >= this.config.durationMinutes * 60) {
        this.finishSession();
      }
      this.emitStats();
    }, 500);
  }

  private scheduleNext(): void {
    if (this.state === "finished") return;
    const diff = DIFFICULTY_CONFIG[this.config.difficulty];
    const delay = this.random.randomDelay(diff.minDelay, diff.maxDelay);
    this.state = "waiting";
    this.callbacks.onStateChange("waiting");
    this.scheduleTimer = setTimeout(() => this.presentSignal(), delay);
  }

  private presentSignal(): void {
    if (this.state === "finished") return;
    const trial = this.generateTrial();
    this.currentTrial = trial;
    this.signalStartTime = performance.now();
    trial.signalTimestamp = this.signalStartTime;
    this.state = "signal";
    this.callbacks.onStateChange("signal");
    this.callbacks.onSignal(trial.signal, trial.expectedAction);

    if (this.isAudioOnly && trial.signal.audio) {
      this.audio.playBeep(trial.expectedAction);
    } else if (trial.signal.audio) {
      this.audio.playBeep(trial.expectedAction);
    }

    const diff = DIFFICULTY_CONFIG[this.config.difficulty];
    const window = this.config.responseWindowMs || diff.responseWindow;

    this.responseWindowTimer = setTimeout(() => {
      if (this.currentTrial && !this.currentTrial.responseTimestamp) {
        this.handleTimeout();
      }
    }, window);
  }

  private generateTrial(): Trial {
    const mode = this.config.mode;
    const isNoGo = this.config.mode === "GO_NO_GO" && Math.random() < (this.config.noGoRatio ?? 0.2);

    let signal: Signal;
    let expected: Action;

    switch (mode) {
      case "COLOR_REACTION":
        [signal, expected] = this.genColorTrial();
        break;
      case "DIRECTION_REACTION":
        [signal, expected] = this.genDirectionTrial();
        break;
      case "AUDIO_REACTION":
        [signal, expected] = this.genAudioTrial();
        break;
      case "VISUAL_AUDIO":
        [signal, expected] = this.genVisualAudioTrial();
        break;
      case "CONFLICT":
        [signal, expected] = this.genConflictTrial();
        break;
      case "GO_NO_GO":
        [signal, expected] = this.genGoNoGoTrial(isNoGo);
        break;
      case "DOUBLE_SIGNAL":
        [signal, expected] = this.genDoubleSignalTrial();
        break;
      case "FAKEOUT":
        [signal, expected] = this.genFakeoutTrial();
        break;
      case "MEMORY":
        [signal, expected] = this.genMemoryTrial();
        break;
      case "RANDOM_COMMAND":
        [signal, expected] = this.genRandomCommandTrial();
        break;
      case "PERIPHERAL":
        [signal, expected] = this.genPeripheralTrial();
        break;
      case "CHAOS":
        [signal, expected] = this.genChaosTrial();
        break;
      case "BRAIN_SHOCK":
        [signal, expected] = this.genBrainShockTrial();
        break;
      default:
        [signal, expected] = this.genColorTrial();
    }

    return {
      id: uid(),
      signal,
      expectedAction: expected,
      signalTimestamp: 0,
      correct: false,
      falseStart: false,
      timeout: false,
      trialType: mode,
      difficulty: this.difficultyLevel,
      noGoViolation: false,
    };
  }

  private genColorTrial(): [Signal, Action] {
    const colors = Object.keys(COLOR_MAP);
    const color = this.random.pickNoRepeat(colors, c => c);
    const action = COLOR_MAP[color];
    return [{
      id: uid(), type: "COLOR", value: color, color,
      duration: 800 + this.random.nextInt(0, 400)
    }, action];
  }

  private genDirectionTrial(): [Signal, Action] {
    const arrows = Object.keys(ARROW_MAP);
    const arrow = this.random.pickNoRepeat(arrows, a => a);
    const action = ARROW_MAP[arrow];
    return [{
      id: uid(), type: "ARROW", value: arrow, direction: arrow,
      duration: 800 + this.random.nextInt(0, 400)
    }, action];
  }

  private genAudioTrial(): [Signal, Action] {
    const keys = Object.keys(AUDIO_MAP);
    const key = this.random.pickNoRepeat(keys, k => k);
    const action = AUDIO_MAP[key];
    return [{
      id: uid(), type: "AUDIO", value: key, audio: key,
      duration: 600
    }, action];
  }

  private genVisualAudioTrial(): [Signal, Action] {
    const colors = ["GREEN", "BLUE"];
    const color = this.random.pick(colors);
    const action = color === "GREEN" ? "RIGHT" : "LEFT";
    return [{
      id: uid(), type: "COMBINED", value: `${color}+TONE`, color,
      audio: color === "GREEN" ? "HIGH" : "LOW",
      duration: 900
    }, action];
  }

  private genConflictTrial(): [Signal, Action] {
    const texts = ["LEFT", "RIGHT"];
    const text = this.random.pick(texts);
    const arrow = text === "LEFT" ? "→" : "←";
    const action = this.rule === "TEXT" ? (text === "LEFT" ? "LEFT" : "RIGHT") :
                   this.rule === "ARROW" ? ARROW_MAP[arrow] :
                   this.rule === "COLOR" ? "LEFT" : "LEFT";
    return [{
      id: uid(), type: "COMBINED", value: text, color: "WHITE",
      direction: arrow, rule: this.rule,
      duration: 1000
    }, action];
  }

  private genGoNoGoTrial(isNoGo: boolean): [Signal, Action] {
    if (isNoGo) {
      return [{
        id: uid(), type: "COLOR", value: "BLUE", color: "BLUE",
        duration: 1000, isNoGo: true
      }, "NO_ACTION"];
    }
    const goColors = ["RED", "GREEN", "YELLOW"];
    const color = this.random.pick(goColors);
    return [{
      id: uid(), type: "COLOR", value: color, color,
      duration: 1000
    }, COLOR_MAP[color]];
  }

  private genDoubleSignalTrial(): [Signal, Action] {
    const [s1, a1] = this.genColorTrial();
    return [s1, a1];
  }

  private genFakeoutTrial(): [Signal, Action] {
    const [finalSignal, finalAction] = this.genColorTrial();
    const fakeColor = this.random.pick(Object.keys(COLOR_MAP).filter(c => c !== finalSignal.color));
    return [{
      ...finalSignal,
      isFakeout: true,
      secondarySignal: {
        id: uid(), type: "COLOR", value: fakeColor, color: fakeColor,
        duration: 150
      }
    }, finalAction];
  }

  private genMemoryTrial(): [Signal, Action] {
    if (this.memorySequence.length === 0) {
      const len = Math.max(2, Math.min(5, Math.floor(this.difficultyLevel / 2) + 2));
      this.memorySequence = [];
      this.sequenceSignals = [];
      for (let i = 0; i < len; i++) {
        const [s, a] = this.genColorTrial();
        this.memorySequence.push(a);
        this.sequenceSignals.push(s);
      }
      this.memoryIndex = 0;
      return [{
        id: uid(), type: "TEXT", value: `MEMORIZE ${len}`,
        duration: 1500
      }, this.memorySequence[0]];
    }
    const action = this.memorySequence[this.memoryIndex];
    const signal = this.sequenceSignals[this.memoryIndex];
    this.memoryIndex++;
    if (this.memoryIndex >= this.memorySequence.length) {
      this.memorySequence = [];
    }
    return [signal, action];
  }

  private genRandomCommandTrial(): [Signal, Action] {
    const action = this.random.pick(this.commandPool.filter(a => a !== "NO_ACTION"));
    return [{
      id: uid(), type: "TEXT", value: action.replace("_", " "),
      duration: 1000
    }, action];
  }

  private genPeripheralTrial(): [Signal, Action] {
    const positions: Array<"left" | "right" | "top" | "bottom"> = ["left", "right", "top", "bottom"];
    const pos = this.random.pick(positions);
    const actionMap: Record<string, Action> = { left: "LEFT", right: "RIGHT", top: "JUMP", bottom: "CROUCH" };
    return [{
      id: uid(), type: "PERIPHERAL", value: pos.toUpperCase(), position: pos,
      duration: 900
    }, actionMap[pos]];
  }

  private genChaosTrial(): [Signal, Action] {
    const r = Math.random();
    if (r < 0.2) return this.genColorTrial();
    if (r < 0.35) return this.genDirectionTrial();
    if (r < 0.45) return this.genAudioTrial();
    if (r < 0.55) return this.genConflictTrial();
    if (r < 0.65) return this.genGoNoGoTrial(Math.random() < 0.3);
    if (r < 0.75) return this.genFakeoutTrial();
    if (r < 0.85) return this.genPeripheralTrial();
    return this.genRandomCommandTrial();
  }

  private genBrainShockTrial(): [Signal, Action] {
    const [s, a] = this.genConflictTrial();
    return [{ ...s, duration: 700 }, a];
  }

  handleMovement(event: MovementEvent): void {
    if (this.state !== "signal" && this.state !== "response_window") return;
    if (!this.currentTrial) return;

    const now = performance.now();
    const trial = this.currentTrial;

    if (now < trial.signalTimestamp) {
      trial.falseStart = true;
      this.falseStartCount++;
      return;
    }

    if (trial.responseTimestamp) return;

    trial.responseTimestamp = now;
    trial.reactionTime = now - trial.signalTimestamp;
    trial.detectedAction = event.type;
    trial.confidence = event.confidence;

    if (trial.expectedAction === "NO_ACTION") {
      trial.noGoViolation = true;
      trial.correct = false;
    } else {
      trial.correct = event.type === trial.expectedAction;
    }

    this.completeTrial(trial);
  }

  handleManualInput(action: Action): void {
    if (this.state !== "signal" && this.state !== "response_window") return;
    if (!this.currentTrial) return;
    const now = performance.now();
    const trial = this.currentTrial;
    if (trial.responseTimestamp) return;

    trial.responseTimestamp = now;
    trial.reactionTime = now - trial.signalTimestamp;
    trial.detectedAction = action;
    trial.confidence = 1;

    if (trial.expectedAction === "NO_ACTION") {
      trial.noGoViolation = true;
      trial.correct = false;
    } else {
      trial.correct = action === trial.expectedAction;
    }

    this.completeTrial(trial);
  }

  private handleTimeout(): void {
    if (!this.currentTrial) return;
    const trial = this.currentTrial;
    trial.timeout = true;
    trial.correct = false;
    this.completeTrial(trial);
  }

  private completeTrial(trial: Trial): void {
    if (this.responseWindowTimer) {
      clearTimeout(this.responseWindowTimer);
      this.responseWindowTimer = null;
    }

    this.trials.push(trial);

    if (trial.correct) {
      this.currentStreak++;
      if (this.currentStreak > this.bestStreak) this.bestStreak = this.currentStreak;
      this.audio.playSuccess();
    } else {
      this.currentStreak = 0;
      if (trial.noGoViolation || trial.falseStart) {
        this.audio.playWarning();
      } else {
        this.audio.playError();
      }
    }

    this.rollingAccuracy.push(trial.correct ? 1 : 0);
    if (this.rollingAccuracy.length > 20) this.rollingAccuracy.shift();
    if (trial.reactionTime && trial.reactionTime < 3000) {
      this.rollingReaction.push(trial.reactionTime);
      if (this.rollingReaction.length > 20) this.rollingReaction.shift();
    }

    this.updateDifficulty();
    this.emitStats();
    this.callbacks.onFeedback(trial);

    setTimeout(() => {
      if (this.shouldFinish()) {
        this.finishSession();
      } else {
        this.scheduleNext();
      }
    }, 400);
  }

  private shouldFinish(): boolean {
    if (this.config.trialCount && this.trials.length >= this.config.trialCount) return true;
    if (this.config.durationMinutes > 0 && this.timeElapsed >= this.config.durationMinutes * 60) return true;
    return false;
  }

  private updateDifficulty(): void {
    const acc = mean(this.rollingAccuracy);
    const medReact = median(this.rollingReaction);
    if (this.rollingAccuracy.length < 5) return;

    if (acc > 0.9 && medReact < 500 && this.falseStartCount < 2) {
      this.difficultyLevel = clamp(this.difficultyLevel + 0.3, 1, 10);
    } else if (acc < 0.65 || this.falseStartCount > 5) {
      this.difficultyLevel = clamp(this.difficultyLevel - 0.5, 1, 10);
    }
  }

  private emitStats(): void {
    const reactions = this.trials.filter(t => t.reactionTime && t.reactionTime > 0).map(t => t.reactionTime!);
    const stats: LiveStats = {
      totalTrials: this.trials.length,
      correct: this.trials.filter(t => t.correct).length,
      incorrect: this.trials.filter(t => !t.correct && !t.timeout).length,
      timeouts: this.trials.filter(t => t.timeout).length,
      falseStarts: this.trials.filter(t => t.falseStart).length,
      noGoErrors: this.trials.filter(t => t.noGoViolation).length,
      currentStreak: this.currentStreak,
      bestStreak: this.bestStreak,
      score: this.computeScore(),
      accuracy: this.trials.length > 0 ? (this.trials.filter(t => t.correct).length / this.trials.length) * 100 : 0,
      medianReaction: median(reactions),
      difficulty: Math.round(this.difficultyLevel),
      timeElapsed: this.timeElapsed,
    };
    this.callbacks.onStatsUpdate?.(stats);
  }

  private computeScore(): number {
    const acc = this.trials.length > 0 ? this.trials.filter(t => t.correct).length / this.trials.length : 0;
    const reactions = this.trials.filter(t => t.reactionTime && t.reactionTime > 0).map(t => t.reactionTime!);
    const medReact = median(reactions) || 800;
    const speedScore = Math.max(0, 100 - (medReact - 200) / 10);
    const consistency = reactions.length > 1 ? Math.max(0, 100 - stdDev(reactions) / 5) : 50;
    const penalty = (this.falseStartCount * 3) + (this.trials.filter(t => t.noGoViolation).length * 5);
    const raw = (acc * 50) + (speedScore * 0.3) + (consistency * 0.2) - penalty;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  private finishSession(): void {
    this.state = "finished";
    this.callbacks.onStateChange("finished");
    if (this.sessionTimer) clearInterval(this.sessionTimer);
    if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
    if (this.responseWindowTimer) clearTimeout(this.responseWindowTimer);

    const reactions = this.trials.filter(t => t.reactionTime && t.reactionTime > 0).map(t => t.reactionTime!);
    const firstHalf = reactions.slice(0, Math.floor(reactions.length / 2));
    const secondHalf = reactions.slice(Math.floor(reactions.length / 2));
    const perfDrop = firstHalf.length > 0 && secondHalf.length > 0
      ? ((median(secondHalf) - median(firstHalf)) / median(firstHalf)) * 100
      : 0;

    const commandStats: Record<string, { accuracy: number; median: number; count: number }> = {};
    for (const trial of this.trials) {
      const key = trial.expectedAction;
      if (!commandStats[key]) commandStats[key] = { accuracy: 0, median: 0, count: 0 };
      commandStats[key].count++;
      if (trial.correct) commandStats[key].accuracy++;
    }
    for (const key of Object.keys(commandStats)) {
      const c = commandStats[key];
      c.accuracy = c.count > 0 ? (c.accuracy / c.count) * 100 : 0;
      const reacts = this.trials.filter(t => t.expectedAction === key && t.reactionTime).map(t => t.reactionTime!);
      c.median = median(reacts);
    }

    const result: SessionResult = {
      id: uid(),
      date: new Date().toISOString(),
      mode: this.config.mode,
      difficulty: this.config.difficulty,
      score: this.computeScore(),
      accuracy: this.trials.length > 0 ? (this.trials.filter(t => t.correct).length / this.trials.length) * 100 : 0,
      medianReaction: median(reactions),
      bestReaction: reactions.length > 0 ? Math.min(...reactions) : 0,
      worstReaction: reactions.length > 0 ? Math.max(...reactions) : 0,
      falseStarts: this.trials.filter(t => t.falseStart).length,
      noGoErrors: this.trials.filter(t => t.noGoViolation).length,
      timeouts: this.trials.filter(t => t.timeout).length,
      totalTrials: this.trials.length,
      correctTrials: this.trials.filter(t => t.correct).length,
      consistency: reactions.length > 1 ? Math.max(0, 100 - stdDev(reactions) / 5) : 0,
      difficultyLevel: Math.round(this.difficultyLevel),
      performanceDrop: perfDrop,
      commandStats,
    };

    this.callbacks.onSessionEnd(result);
  }

  stop(): void {
    if (this.sessionTimer) clearInterval(this.sessionTimer);
    if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
    if (this.responseWindowTimer) clearTimeout(this.responseWindowTimer);
    this.state = "idle";
  }

  getState(): EngineState { return this.state; }
  getTrials(): Trial[] { return this.trials; }

  private difficultyToNumber(d: DifficultyLevel): number {
    return { BEGINNER: 1, INTERMEDIATE: 3, ADVANCED: 5, EXPERT: 7, EXTREME: 9 }[d] ?? 1;
  }
}
