import type { CalibrationData, PoseData, Action, MovementEvent } from "../types";

export class MovementClassifier {
  private lastEventTime = 0;
  private debounceMs = 350;
  private confidenceThreshold = 0.75;
  private state: "neutral" | "jumping" | "crouching" | "left" | "right" = "neutral";
  private jumpStartY = 0;
  private crouchStartY = 0;

  setConfidenceThreshold(v: number): void { this.confidenceThreshold = v; }
  setDebounceMs(v: number): void { this.debounceMs = v; }

  classify(pose: PoseData, calibration: CalibrationData): MovementEvent | null {
    const now = performance.now();
    if (now - this.lastEventTime < this.debounceMs) return null;

    const lm = pose.landmarks;
    const nose = lm[0];
    const leftHip = lm[23];
    const rightHip = lm[24];
    const leftKnee = lm[25];
    const rightKnee = lm[26];
    const leftAnkle = lm[27];
    const rightAnkle = lm[28];

    const hipY = (leftHip.y + rightHip.y) / 2;
    const centerX = nose.x;
    const centerY = nose.y;
    const kneeAngle = this.computeKneeAngle(lm);

    let event: MovementEvent | null = null;
    let confidence = 0;

    if (centerY < calibration.jumpBaseline && this.state !== "jumping") {
      this.jumpStartY = centerY;
      this.state = "jumping";
    }
    if (this.state === "jumping" && centerY > calibration.neutralY - 0.02) {
      const displacement = calibration.neutralY - this.jumpStartY;
      confidence = Math.min(1, displacement / 0.08);
      if (confidence >= this.confidenceThreshold) {
        event = { type: "JUMP", timestamp: now, confidence };
        this.state = "neutral";
      }
    }

    if (!event && hipY > calibration.crouchBaseline && kneeAngle < 140 && this.state !== "crouching") {
      this.crouchStartY = hipY;
      this.state = "crouching";
    }
    if (!event && this.state === "crouching" && hipY < calibration.crouchBaseline - 0.02) {
      const displacement = this.crouchStartY - calibration.neutralY;
      confidence = Math.min(1, displacement / 0.06);
      if (confidence >= this.confidenceThreshold) {
        event = { type: "CROUCH", timestamp: now, confidence };
        this.state = "neutral";
      }
    }

    if (!event && centerX < calibration.leftThreshold) {
      confidence = Math.min(1, (calibration.leftThreshold - centerX) / 0.08);
      if (confidence >= this.confidenceThreshold && this.state !== "left") {
        event = { type: "LEFT", timestamp: now, confidence };
        this.state = "left";
      }
    }
    if (!event && centerX > calibration.rightThreshold) {
      confidence = Math.min(1, (centerX - calibration.rightThreshold) / 0.08);
      if (confidence >= this.confidenceThreshold && this.state !== "right") {
        event = { type: "RIGHT", timestamp: now, confidence };
        this.state = "right";
      }
    }

    if (centerX >= calibration.leftThreshold && centerX <= calibration.rightThreshold &&
        centerY >= calibration.jumpBaseline && hipY <= calibration.crouchBaseline) {
      this.state = "neutral";
    }

    if (event) {
      this.lastEventTime = now;
      return event;
    }
    return null;
  }

  private computeKneeAngle(lm: any[]): number {
    const hip = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
    const knee = { x: (lm[25].x + lm[26].x) / 2, y: (lm[25].y + lm[26].y) / 2 };
    const ankle = { x: (lm[27].x + lm[28].x) / 2, y: (lm[27].y + lm[28].y) / 2 };
    const a = Math.hypot(hip.x - knee.x, hip.y - knee.y);
    const b = Math.hypot(ankle.x - knee.x, ankle.y - knee.y);
    const c = Math.hypot(hip.x - ankle.x, hip.y - ankle.y);
    const angle = Math.acos((a * a + b * b - c * c) / (2 * a * b)) * (180 / Math.PI);
    return angle;
  }

  reset(): void {
    this.state = "neutral";
    this.lastEventTime = 0;
  }
}
