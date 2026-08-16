import type { PoseData } from "../types";

let PoseClass: any = null;
let CameraClass: any = null;

export interface PoseDetectorConfig {
  modelComplexity?: number;
  smoothLandmarks?: boolean;
  minDetectionConfidence?: number;
  minTrackingConfidence?: number;
}

export class PoseDetector {
  private pose: any = null;
  private camera: any = null;
  private isLoaded = false;
  private onResultsCb: ((data: PoseData) => void) | null = null;
  private videoEl: HTMLVideoElement | null = null;

  async load(config: PoseDetectorConfig = {}): Promise<void> {
    if (this.isLoaded) return;
    const poseMod = await import("@mediapipe/pose");
    const camMod = await import("@mediapipe/camera_utils");
    PoseClass = poseMod.Pose;
    CameraClass = camMod.Camera;
    this.pose = new PoseClass({
      locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });
    this.pose.setOptions({
      modelComplexity: config.modelComplexity ?? 1,
      smoothLandmarks: config.smoothLandmarks ?? true,
      minDetectionConfidence: config.minDetectionConfidence ?? 0.5,
      minTrackingConfidence: config.minTrackingConfidence ?? 0.5,
    });
    this.pose.onResults((results: any) => {
      if (this.onResultsCb && results.poseLandmarks) {
        this.onResultsCb({
          landmarks: results.poseLandmarks,
          timestamp: performance.now(),
        });
      }
    });
    this.isLoaded = true;
  }

  startCamera(videoEl: HTMLVideoElement, onResults: (data: PoseData) => void): void {
    this.onResultsCb = onResults;
    this.videoEl = videoEl;
    if (!this.pose) throw new Error("Pose not loaded");
    if (!CameraClass) throw new Error("Camera utils not loaded");
    this.camera = new CameraClass(videoEl, {
      onFrame: async () => {
        if (this.pose && videoEl.readyState >= 2) {
          await this.pose.send({ image: videoEl });
        }
      },
      width: 640,
      height: 480,
    });
    this.camera.start();
  }

  stop(): void {
    if (this.camera) {
      this.camera.stop();
      this.camera = null;
    }
    this.onResultsCb = null;
  }

  getLoaded(): boolean { return this.isLoaded; }
}
