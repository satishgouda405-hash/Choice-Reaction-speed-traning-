import type { Action } from "../types";

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private volume = 0.5;
  private enabled = true;

  init(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  setEnabled(v: boolean): void { this.enabled = v; }
  setVolume(v: number): void { this.volume = clamp(v, 0, 1); }

  playTone(freq: number, duration: number, type: OscillatorType = "sine", when?: number): void {
    if (!this.enabled || !this.ctx) return;
    const t = when ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(this.volume * 0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  playBeep(action: Action): void {
    const map: Record<string, { freq: number; type: OscillatorType }> = {
      LEFT: { freq: 440, type: "sine" },
      RIGHT: { freq: 880, type: "sine" },
      JUMP: { freq: 660, type: "square" },
      CROUCH: { freq: 330, type: "triangle" },
      NO_ACTION: { freq: 220, type: "sawtooth" },
    };
    const cfg = map[action] ?? { freq: 550, type: "sine" };
    this.playTone(cfg.freq, 0.15, cfg.type);
  }

  playSuccess(): void {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.playTone(880, 0.1, "sine", t);
    this.playTone(1100, 0.2, "sine", t + 0.08);
  }

  playError(): void {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.playTone(200, 0.3, "sawtooth", t);
    this.playTone(150, 0.3, "sawtooth", t + 0.15);
  }

  playWarning(): void {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.playTone(600, 0.1, "square", t);
    this.playTone(600, 0.1, "square", t + 0.15);
  }

  playCountdown(): void {
    if (!this.enabled || !this.ctx) return;
    this.playTone(1000, 0.08, "sine");
  }

  playStart(): void {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.playTone(440, 0.1, "sine", t);
    this.playTone(660, 0.1, "sine", t + 0.1);
    this.playTone(880, 0.3, "sine", t + 0.2);
  }
}
