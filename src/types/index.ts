export type Action =
  | "JUMP"
  | "LEFT"
  | "RIGHT"
  | "CROUCH"
  | "FORWARD"
  | "BACK"
  | "TURN_LEFT"
  | "TURN_RIGHT"
  | "NO_ACTION";

export type SignalType =
  | "COLOR"
  | "TEXT"
  | "ARROW"
  | "AUDIO"
  | "COMBINED"
  | "SHAPE"
  | "PERIPHERAL";

export type TrainingMode =
  | "COLOR_REACTION"
  | "DIRECTION_REACTION"
  | "AUDIO_REACTION"
  | "VISUAL_AUDIO"
  | "CONFLICT"
  | "GO_NO_GO"
  | "DOUBLE_SIGNAL"
  | "FAKEOUT"
  | "MEMORY"
  | "RANDOM_COMMAND"
  | "PERIPHERAL"
  | "CHAOS"
  | "BRAIN_SHOCK";

export type DifficultyLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "EXPERT" | "EXTREME";

export type BodyMode = "DESK" | "FULL_BODY";

export type RuleType = "TEXT" | "ARROW" | "COLOR" | "SOUND";

export interface Signal {
  id: string;
  type: SignalType;
  value: string;
  color?: string;
  audio?: string;
  direction?: string;
  position?: "left" | "right" | "center" | "top" | "bottom";
  duration: number;
  isNoGo?: boolean;
  isFakeout?: boolean;
  rule?: RuleType;
  secondarySignal?: Signal;
}

export interface Trial {
  id: string;
  signal: Signal;
  expectedAction: Action;
  signalTimestamp: number;
  responseTimestamp?: number;
  reactionTime?: number;
  detectedAction?: Action;
  confidence?: number;
  correct: boolean;
  falseStart: boolean;
  timeout: boolean;
  trialType: TrainingMode;
  difficulty: number;
  noGoViolation?: boolean;
}

export interface SessionConfig {
  mode: TrainingMode;
  difficulty: DifficultyLevel;
  durationMinutes: number;
  trialCount?: number;
  cameraEnabled: boolean;
  audioEnabled: boolean;
  bodyMode: BodyMode;
  responseWindowMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  commands: Action[];
  rule?: RuleType;
  noGoRatio?: number;
  fakeoutRatio?: number;
  sequenceLength?: number;
  enablePeripheral?: boolean;
}

export interface CalibrationData {
  neutralX: number;
  neutralY: number;
  leftThreshold: number;
  rightThreshold: number;
  jumpBaseline: number;
  crouchBaseline: number;
  headY: number;
  hipY: number;
  kneeY: number;
  ankleY: number;
  timestamp: number;
}

export interface SessionResult {
  id: string;
  date: string;
  mode: TrainingMode;
  difficulty: DifficultyLevel;
  score: number;
  accuracy: number;
  medianReaction: number;
  bestReaction: number;
  worstReaction: number;
  falseStarts: number;
  noGoErrors: number;
  timeouts: number;
  totalTrials: number;
  correctTrials: number;
  consistency: number;
  difficultyLevel: number;
  performanceDrop?: number;
  commandStats: Record<string, { accuracy: number; median: number; count: number }>;
}

export interface PersonalRecords {
  fastestReaction: number;
  bestAccuracy: number;
  longestStreak: number;
  highestScore: number;
  bestInhibitionScore: number;
  bestSessionId?: string;
  bestByDifficulty: Record<string, number>;
}

export interface MovementEvent {
  type: Action;
  timestamp: number;
  confidence: number;
  rawData?: PoseData;
}

export interface PoseData {
  landmarks: Array<{ x: number; y: number; z: number; visibility: number }>;
  timestamp: number;
}

export interface TrainingProfile {
  id: string;
  name: string;
  config: Partial<SessionConfig>;
}
