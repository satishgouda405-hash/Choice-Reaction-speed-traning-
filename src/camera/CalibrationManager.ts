import type { CalibrationData, PoseData } from "../types";

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export class CalibrationManager {
  data: CalibrationData | null = null;
  private samples: PoseData[] = [];

  reset(): void {
    this.samples = [];
    this.data = null;
  }

  addSample(pose: PoseData): void {
    this.samples.push(pose);
  }

  compute(): CalibrationData | null {
    if (this.samples.length < 10) return null;
    const avg = (idx: number, axis: "x" | "y") =>
      mean(this.samples.map(s => s.landmarks[idx][axis]));

    const noseY = avg(0, "y");
    const leftHipY = avg(23, "y");
    const rightHipY = avg(24, "y");
    const leftKneeY = avg(25, "y");
    const rightKneeY = avg(26, "y");
    const leftAnkleY = avg(27, "y");
    const rightAnkleY = avg(28, "y");
    const hipY = (leftHipY + rightHipY) / 2;
    const kneeY = (leftKneeY + rightKneeY) / 2;
    const ankleY = (leftAnkleY + rightAnkleY) / 2;
    const centerX = avg(0, "x");
    const centerY = noseY;

    this.data = {
      neutralX: centerX,
      neutralY: centerY,
      leftThreshold: centerX - 0.12,
      rightThreshold: centerX + 0.12,
      jumpBaseline: noseY - 0.08,
      crouchBaseline: hipY + 0.06,
      headY: noseY,
      hipY,
      kneeY,
      ankleY,
      timestamp: Date.now(),
    };
    return this.data;
  }

  calibrateLeft(pose: PoseData): void {
    if (!this.data) return;
    const x = pose.landmarks[0].x;
    this.data.leftThreshold = x + 0.02;
  }

  calibrateRight(pose: PoseData): void {
    if (!this.data) return;
    const x = pose.landmarks[0].x;
    this.data.rightThreshold = x - 0.02;
  }

  calibrateJump(pose: PoseData): void {
    if (!this.data) return;
    this.data.jumpBaseline = pose.landmarks[0].y - 0.05;
  }

  calibrateCrouch(pose: PoseData): void {
    if (!this.data) return;
    const hipY = (pose.landmarks[23].y + pose.landmarks[24].y) / 2;
    this.data.crouchBaseline = hipY + 0.04;
  }
}
