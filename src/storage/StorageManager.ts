import type { SessionResult, CalibrationData, PersonalRecords, TrainingProfile } from "../types";

const PREFIX = "reflex_x_";

export class StorageManager {
  static saveSession(result: SessionResult): void {
    const sessions = this.getSessions();
    sessions.unshift(result);
    if (sessions.length > 200) sessions.pop();
    localStorage.setItem(`${PREFIX}sessions`, JSON.stringify(sessions));
    this.updateRecords(result);
  }

  static getSessions(): SessionResult[] {
    const raw = localStorage.getItem(`${PREFIX}sessions`);
    return raw ? JSON.parse(raw) : [];
  }

  static saveCalibration(data: CalibrationData): void {
    localStorage.setItem(`${PREFIX}calibration`, JSON.stringify(data));
  }

  static getCalibration(): CalibrationData | null {
    const raw = localStorage.getItem(`${PREFIX}calibration`);
    return raw ? JSON.parse(raw) : null;
  }

  static getRecords(): PersonalRecords {
    const raw = localStorage.getItem(`${PREFIX}records`);
    return raw ? JSON.parse(raw) : {
      fastestReaction: 9999,
      bestAccuracy: 0,
      longestStreak: 0,
      highestScore: 0,
      bestInhibitionScore: 0,
      bestByDifficulty: {}
    };
  }

  static updateRecords(result: SessionResult): void {
    const rec = this.getRecords();
    if (result.bestReaction < rec.fastestReaction) rec.fastestReaction = result.bestReaction;
    if (result.accuracy > rec.bestAccuracy) rec.bestAccuracy = result.accuracy;
    if (result.score > rec.highestScore) {
      rec.highestScore = result.score;
      rec.bestSessionId = result.id;
    }
    const diffKey = result.difficulty;
    if (!rec.bestByDifficulty[diffKey] || result.score > rec.bestByDifficulty[diffKey]) {
      rec.bestByDifficulty[diffKey] = result.score;
    }
    localStorage.setItem(`${PREFIX}records`, JSON.stringify(rec));
  }

  static saveProfiles(profiles: TrainingProfile[]): void {
    localStorage.setItem(`${PREFIX}profiles`, JSON.stringify(profiles));
  }

  static getProfiles(): TrainingProfile[] {
    const raw = localStorage.getItem(`${PREFIX}profiles`);
    return raw ? JSON.parse(raw) : [];
  }

  static exportJSON(): string {
    const data = {
      sessions: this.getSessions(),
      records: this.getRecords(),
      calibration: this.getCalibration(),
      profiles: this.getProfiles(),
      exportedAt: new Date().toISOString()
    };
    return JSON.stringify(data, null, 2);
  }

  static exportCSV(): string {
    const sessions = this.getSessions();
    if (sessions.length === 0) return "No data";
    const headers = ["Date", "Mode", "Difficulty", "Score", "Accuracy", "MedianReaction", "BestReaction", "FalseStarts", "NoGoErrors", "TotalTrials"];
    const rows = sessions.map(s => [
      s.date, s.mode, s.difficulty, s.score, s.accuracy, s.medianReaction, s.bestReaction,
      s.falseStarts, s.noGoErrors, s.totalTrials
    ].join(","));
    return [headers.join(","), ...rows].join("\n");
  }

  static reset(what: "session" | "history" | "calibration" | "all"): void {
    if (what === "history" || what === "all") {
      localStorage.removeItem(`${PREFIX}sessions`);
      localStorage.removeItem(`${PREFIX}records`);
    }
    if (what === "calibration" || what === "all") {
      localStorage.removeItem(`${PREFIX}calibration`);
    }
    if (what === "all") {
      localStorage.removeItem(`${PREFIX}profiles`);
    }
  }
}
