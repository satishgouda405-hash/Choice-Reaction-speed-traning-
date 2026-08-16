import { MovementEvent, CalibrationData } from '../types';

export class MovementClassifier {
  private calibration: CalibrationData | null = null;
  private lastMovementTime: number = 0;
  private debounceMs: number = 400;

  public setCalibration(calibration: CalibrationData): void {
    this.calibration = calibration;
  }

  public getCalibration(): CalibrationData | null {
    return this.calibration;
  }

  public classify(landmarks: any[]): MovementEvent | null {
    if (!landmarks || landmarks.length < 24) return null;

    const now = performance.now();
    if (now - this.lastMovementTime < this.debounceMs) {
      return null;
    }

    const nose = landmarks[0];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    if (!nose || !leftHip || !rightHip) return null;

    const bodyCenterX = (leftHip.x + rightHip.x) / 2;
    const bodyCenterY = (leftHip.y + rightHip.y) / 2;

    const neutralX = this.calibration?.neutralPosition.x ?? 0.5;
    const neutralY = this.calibration?.neutralPosition.y ?? 0.5;

    const leftThreshold = this.calibration?.leftThreshold ?? 0.4;
    const rightThreshold = this.calibration?.rightThreshold ?? 0.6;
    const jumpBaseline = this.calibration?.jumpBaseline ?? 0.4;
    const crouchBaseline = this.calibration?.crouchBaseline ?? 0.6;

    let detectedType: MovementEvent['type'] | null = null;
    let confidence = 0.85;

    if (bodyCenterX < leftThreshold) {
      detectedType = 'LEFT';
    } else if (bodyCenterX > rightThreshold) {
      detectedType = 'RIGHT';
    } else if (bodyCenterY < jumpBaseline) {
      detectedType = 'JUMP';
    } else if (bodyCenterY > crouchBaseline) {
      detectedType = 'CROUCH';
    }

    if (detectedType) {
      this.lastMovementTime = now;
      return {
        type: detectedType,
        timestamp: now,
        confidence
      };
    }

    return null;
  }
}
