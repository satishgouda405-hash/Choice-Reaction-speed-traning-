import React, { useState, useEffect, useRef, useCallback } from "react";
import type {
  SessionConfig, Trial, SessionResult, CalibrationData,
  Action, TrainingMode, DifficultyLevel, BodyMode, RuleType,
  Signal, PersonalRecords, PoseData
} from "./types";
import { TrainingEngine, type EngineState, type LiveStats } from "./engine/TrainingEngine";
import { AudioEngine } from "./audio/AudioEngine";
import { StorageManager } from "./storage/StorageManager";
import { PoseDetector } from "./camera/PoseDetector";
import { CalibrationManager } from "./camera/CalibrationManager";
import { MovementClassifier } from "./camera/MovementClassifier";
import { formatMs, median, stdDev, clamp } from "./utils/helpers";

type Screen = "welcome" | "mode" | "config" | "safety" | "calibration" | "training" | "results" | "history" | "settings";

const MODES: { id: TrainingMode; name: string; desc: string }[] = [
  { id: "COLOR_REACTION", name: "Color Reaction", desc: "React to color signals: RED=JUMP, BLUE=LEFT, GREEN=RIGHT, YELLOW=CROUCH" },
  { id: "DIRECTION_REACTION", name: "Direction", desc: "React to arrow directions" },
  { id: "AUDIO_REACTION", name: "Audio Only", desc: "React to sound cues without visual aid" },
  { id: "VISUAL_AUDIO", name: "Visual + Audio", desc: "Process combined visual and audio signals" },
  { id: "CONFLICT", name: "Conflict", desc: "Resolve conflicting text, arrow, and color information" },
  { id: "GO_NO_GO", name: "Go / No-Go", desc: "Inhibition training — do NOT move on certain signals" },
  { id: "DOUBLE_SIGNAL", name: "Double Signal", desc: "Rapid sequential reactions" },
  { id: "FAKEOUT", name: "Fakeout", desc: "Avoid premature reactions to brief decoy signals" },
  { id: "MEMORY", name: "Memory", desc: "Reproduce movement sequences from memory" },
  { id: "RANDOM_COMMAND", name: "Random Command", desc: "Text-based movement commands" },
  { id: "PERIPHERAL", name: "Peripheral", desc: "React to signals at screen edges" },
  { id: "CHAOS", name: "Chaos", desc: "Unpredictable mix of all challenge types" },
  { id: "BRAIN_SHOCK", name: "Brain Shock", desc: "Expert extreme mode with conflicting rapid signals" },
];

const PROFILES: Record<string, Partial<SessionConfig>> = {
  Beginner: { difficulty: "BEGINNER", durationMinutes: 1, commands: ["LEFT", "RIGHT"], responseWindowMs: 2000 },
  Athlete: { difficulty: "ADVANCED", durationMinutes: 5, commands: ["JUMP", "LEFT", "RIGHT", "CROUCH"] },
  Reaction: { difficulty: "INTERMEDIATE", durationMinutes: 3, commands: ["LEFT", "RIGHT"] },
  Decision: { difficulty: "ADVANCED", durationMinutes: 5, commands: ["JUMP", "LEFT", "RIGHT", "CROUCH"], noGoRatio: 0.2 },
  Inhibition: { difficulty: "ADVANCED", durationMinutes: 3, mode: "GO_NO_GO", noGoRatio: 0.3 },
  Peripheral: { difficulty: "INTERMEDIATE", durationMinutes: 3, mode: "PERIPHERAL" },
  Memory: { difficulty: "INTERMEDIATE", durationMinutes: 3, mode: "MEMORY" },
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [config, setConfig] = useState<SessionConfig>({
    mode: "COLOR_REACTION",
    difficulty: "BEGINNER",
    durationMinutes: 3,
    cameraEnabled: false,
    audioEnabled: true,
    bodyMode: "DESK",
    responseWindowMs: 2000,
    minDelayMs: 1500,
    maxDelayMs: 3500,
    commands: ["JUMP", "LEFT", "RIGHT", "CROUCH"],
    noGoRatio: 0.2,
    fakeoutRatio: 0,
  });

  const [engineState, setEngineState] = useState<EngineState>("idle");
  const [currentSignal, setCurrentSignal] = useState<Signal | null>(null);
  const [lastTrial, setLastTrial] = useState<Trial | null>(null);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [records, setRecords] = useState<PersonalRecords>(StorageManager.getRecords());

  const audioRef = useRef(new AudioEngine());
  const videoRef = useRef<HTMLVideoElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const poseDetectorRef = useRef<PoseDetector | null>(null);
  const calibrationRef = useRef(new CalibrationManager());
  const classifierRef = useRef(new MovementClassifier());
  const engineRef = useRef<TrainingEngine | null>(null);
  const latestPoseRef = useRef<PoseData | null>(null);
  const [calibrationStep, setCalibrationStep] = useState(0);
  const [calibrationData, setCalibrationData] = useState<CalibrationData | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [history, setHistory] = useState<SessionResult[]>([]);
  const [wakeLock, setWakeLock] = useState<any>(null);

  useEffect(() => {
    const initAudio = () => audioRef.current.init();
    window.addEventListener("click", initAudio, { once: true });
    window.addEventListener("keydown", initAudio, { once: true });
    return () => {
      window.removeEventListener("click", initAudio);
      window.removeEventListener("keydown", initAudio);
    };
  }, []);

  useEffect(() => {
    setHistory(StorageManager.getSessions());
  }, [screen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (screen !== "training") return;
      const map: Record<string, Action> = {
        ArrowLeft: "LEFT", ArrowRight: "RIGHT", ArrowUp: "JUMP", ArrowDown: "CROUCH",
        a: "LEFT", d: "RIGHT", w: "JUMP", s: "CROUCH",
        A: "LEFT", D: "RIGHT", W: "JUMP", S: "CROUCH",
        " ": "JUMP", Shift: "CROUCH",
      };
      if (map[e.key]) {
        e.preventDefault();
        engineRef.current?.handleManualInput(map[e.key]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [screen]);

  const setupCamera = useCallback(async () => {
    try {
      setCameraError(null);
      if (!poseDetectorRef.current) {
        poseDetectorRef.current = new PoseDetector();
        await poseDetectorRef.current.load();
      }
      if (videoRef.current) {
        poseDetectorRef.current.startCamera(videoRef.current, (pose) => {
          latestPoseRef.current = pose;
          handlePose(pose);
        });
      }
    } catch (err: any) {
      setCameraError(err.message || "Camera failed to initialize.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    poseDetectorRef.current?.stop();
  }, []);

  const handlePose = useCallback((pose: PoseData) => {
    const cal = calibrationRef.current.data;
    if (!cal) return;
    const evt = classifierRef.current.classify(pose, cal);
    if (evt) {
      engineRef.current?.handleMovement(evt);
    }
    if (debugMode && debugCanvasRef.current && videoRef.current) {
      drawDebug(pose, cal, debugCanvasRef.current, videoRef.current);
    }
  }, [debugMode]);

  function drawDebug(pose: PoseData, cal: CalibrationData, canvas: HTMLCanvasElement, video: HTMLVideoElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const lm = pose.landmarks;
    const connections = [[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],[27,29],[28,30],[29,31],[30,32]];
    ctx.strokeStyle = "#00d4aa";
    ctx.lineWidth = 2;
    for (const [a, b] of connections) {
      if (lm[a] && lm[b] && lm[a].visibility > 0.5 && lm[b].visibility > 0.5) {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
        ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
        ctx.stroke();
      }
    }
    for (const p of lm) {
      if (p.visibility > 0.5) {
        ctx.fillStyle = "#00d4aa";
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = "#ff4757";
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(cal.leftThreshold * canvas.width, 0);
    ctx.lineTo(cal.leftThreshold * canvas.width, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cal.rightThreshold * canvas.width, 0);
    ctx.lineTo(cal.rightThreshold * canvas.width, canvas.height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffa502";
    ctx.beginPath();
    ctx.arc(cal.neutralX * canvas.width, cal.neutralY * canvas.height, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  const calibrationSteps = ["neutral", "left", "right", "jump", "crouch"];
  const runCalibration = useCallback(async () => {
    await setupCamera();
    setCalibrationStep(0);
    setScreen("calibration");
  }, [setupCamera]);

  const captureCalibration = useCallback(() => {
    const step = calibrationSteps[calibrationStep];
    const pose = latestPoseRef.current;
    if (!pose) {
      setCameraError("No pose detected. Ensure full body is visible.");
      return;
    }
    if (step === "neutral") {
      calibrationRef.current.reset();
      let count = 0;
      const interval = setInterval(() => {
        const p = latestPoseRef.current;
        if (p) calibrationRef.current.addSample(p);
        count++;
        if (count >= 30) {
          clearInterval(interval);
          const data = calibrationRef.current.compute();
          if (data) { setCalibrationData(data); setCalibrationStep(1); }
          else { setCameraError("Calibration failed. Please try again."); }
        }
      }, 100);
    } else if (step === "left") {
      calibrationRef.current.calibrateLeft(pose);
      setCalibrationStep(2);
    } else if (step === "right") {
      calibrationRef.current.calibrateRight(pose);
      setCalibrationStep(3);
    } else if (step === "jump") {
      calibrationRef.current.calibrateJump(pose);
      setCalibrationStep(4);
    } else if (step === "crouch") {
      calibrationRef.current.calibrateCrouch(pose);
      const final = calibrationRef.current.data;
      if (final) {
        StorageManager.saveCalibration(final);
        setCalibrationData(final);
        setCalibrationStep(5);
        setScreen("training");
        startTraining();
      }
    }
  }, [calibrationStep]);

  const startTraining = useCallback(() => {
    const audio = audioRef.current;
    const eng = new TrainingEngine(config, {
      onStateChange: (s) => setEngineState(s),
      onSignal: (sig, exp) => {
        setCurrentSignal(sig);
        setLastTrial(null);
      },
      onFeedback: (trial) => {
        setLastTrial(trial);
        setCurrentSignal(null);
      },
      onSessionEnd: (result) => {
        setSessionResult(result);
        StorageManager.saveSession(result);
        setRecords(StorageManager.getRecords());
        setScreen("results");
        if (wakeLock) wakeLock.release();
      },
      onCountdown: (n) => setCountdown(n),
      onStatsUpdate: (stats) => setLiveStats(stats),
    }, audio);
    engineRef.current = eng;
    setEngineState("idle");
    eng.start();

    if ("wakeLock" in navigator) {
      (navigator as any).wakeLock.request("screen").then((wl: any) => setWakeLock(wl)).catch(() => {});
    }
  }, [config, wakeLock]);

  const stopTraining = useCallback(() => {
    engineRef.current?.stop();
    if (wakeLock) wakeLock.release();
    setScreen("mode");
  }, [wakeLock]);

  const WelcomeScreen = () => (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center animate-slide-in">
      <div className="mb-6">
        <h1 className="text-6xl font-black tracking-tighter mb-2 text-accent">REFLEX//X</h1>
        <p className="text-xl text-text-muted">Solo Reaction, Decision & Movement Training System</p>
      </div>
      <div className="max-w-md space-y-4 mb-8">
        <p className="text-text-muted">Train reaction speed, decision-making, inhibition, and cognitive flexibility — without a partner.</p>
      </div>
      <div className="flex gap-4">
        <button className="primary text-lg px-8 py-4" onClick={() => { localStorage.setItem("reflex_x_seen_welcome", "1"); setScreen("mode"); }}>
          GET STARTED
        </button>
      </div>
      <p className="mt-8 text-xs text-text-muted">No account required. Camera processing is local.</p>
    </div>
  );

  const ModeScreen = () => (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-3xl font-bold">Select Training Mode</h2>
          <button className="ghost" onClick={() => setScreen("settings")}>Settings</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {MODES.map((m) => (
            <div
              key={m.id}
              className={`card cursor-pointer transition-all hover:border-accent ${config.mode === m.id ? "border-accent" : ""}`}
              onClick={() => setConfig({ ...config, mode: m.id })}
            >
              <h3 className="text-lg font-bold mb-1">{m.name}</h3>
              <p className="text-sm text-text-muted">{m.desc}</p>
              {m.id === "BRAIN_SHOCK" && <span className="text-xs text-danger mt-2 inline-block">EXPERT ONLY</span>}
            </div>
          ))}
        </div>
        <div className="flex justify-between">
          <button onClick={() => setScreen("history")}>History</button>
          <button className="primary" onClick={() => setScreen("config")}>Configure Session →</button>
        </div>
      </div>
    </div>
  );

  const ConfigScreen = () => (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-3xl font-bold mb-6">Session Configuration</h2>
        <div className="space-y-6">
          <div className="card space-y-4">
            <h3 className="font-bold text-accent">Profile</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(PROFILES).map(([name, prof]) => (
                <button key={name} className="text-sm" onClick={() => setConfig({ ...config, ...prof } as SessionConfig)}>{name}</button>
              ))}
            </div>
          </div>
          <div className="card space-y-4">
            <h3 className="font-bold text-accent">Difficulty</h3>
            <div className="flex gap-2 flex-wrap">
              {(["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT", "EXTREME"] as DifficultyLevel[]).map((d) => (
                <button key={d} className={config.difficulty === d ? "primary" : ""} onClick={() => setConfig({ ...config, difficulty: d })}>{d}</button>
              ))}
            </div>
          </div>
          <div className="card space-y-4">
            <h3 className="font-bold text-accent">Duration</h3>
            <div className="flex gap-2 flex-wrap">
              {[1, 3, 5, 10, 15].map((m) => (
                <button key={m} className={config.durationMinutes === m ? "primary" : ""} onClick={() => setConfig({ ...config, durationMinutes: m })}>{m} min</button>
              ))}
            </div>
          </div>
          <div className="card space-y-4">
            <h3 className="font-bold text-accent">Body Mode</h3>
            <div className="flex gap-4 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={config.bodyMode === "DESK"} onChange={() => setConfig({ ...config, bodyMode: "DESK", cameraEnabled: false })} />
                <span>Desk Mode (keyboard / touch / mouse)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={config.bodyMode === "FULL_BODY"} onChange={() => setConfig({ ...config, bodyMode: "FULL_BODY", cameraEnabled: true })} />
                <span>Full Body (camera detection)</span>
              </label>
            </div>
          </div>
          {config.mode === "CONFLICT" && (
            <div className="card space-y-4">
              <h3 className="font-bold text-accent">Conflict Rule</h3>
              <select value={config.rule} onChange={(e) => setConfig({ ...config, rule: e.target.value as RuleType })}>
                <option value="TEXT">Follow Text</option>
                <option value="ARROW">Follow Arrow</option>
                <option value="COLOR">Follow Color</option>
              </select>
            </div>
          )}
          <div className="card space-y-4">
            <h3 className="font-bold text-accent">Audio</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={config.audioEnabled} onChange={(e) => setConfig({ ...config, audioEnabled: e.target.checked })} />
              <span>Enable audio cues</span>
            </label>
          </div>
        </div>
        <div className="flex justify-between mt-8">
          <button onClick={() => setScreen("mode")}>← Back</button>
          <button className="primary" onClick={() => {
            if (config.bodyMode === "FULL_BODY" && config.cameraEnabled) setScreen("safety");
            else { setScreen("training"); startTraining(); }
          }}>Start Training</button>
        </div>
      </div>
    </div>
  );

  const SafetyScreen = () => (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <div className="max-w-lg space-y-6">
        <h2 className="text-3xl font-bold text-warning">SAFETY CHECK</h2>
        <div className="card text-left space-y-3">
          <p className="font-semibold">Before training, ensure:</p>
          <ul className="list-disc pl-5 space-y-1 text-text-muted">
            <li>Clear area with no obstacles</li>
            <li>No sharp objects, stairs, or slippery surfaces nearby</li>
            <li>Adequate lighting</li>
            <li>No people immediately around you</li>
            <li>Stable camera position</li>
          </ul>
        </div>
        <p className="text-sm text-text-muted">This is a training application, not a medical device. Stop if you feel discomfort.</p>
        <div className="flex gap-4 justify-center">
          <button onClick={() => setScreen("config")}>← Back</button>
          <button className="primary" onClick={() => {
            const cal = StorageManager.getCalibration();
            if (cal && config.bodyMode === "FULL_BODY") {
              calibrationRef.current.data = cal;
              setCalibrationData(cal);
              setScreen("training");
              startTraining();
            } else {
              runCalibration();
            }
          }}>I Understand — Proceed</button>
        </div>
      </div>
    </div>
  );

  const CalibrationScreen = () => (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <div className="max-w-lg w-full text-center space-y-6">
        <h2 className="text-3xl font-bold">Camera Calibration</h2>
        <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden border border-border">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <canvas ref={debugCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          {cameraError && <div className="absolute inset-0 flex items-center justify-center text-danger bg-black/80">{cameraError}</div>}
        </div>
        <div className="card">
          <p className="text-lg font-bold mb-2">Step {calibrationStep + 1} of 5: {calibrationSteps[calibrationStep].toUpperCase()}</p>
          <p className="text-text-muted text-sm mb-4">
            {calibrationStep === 0 && "Stand in neutral position. Keep full body visible for 3 seconds."}
            {calibrationStep === 1 && "Move to your LEFT boundary and hold."}
            {calibrationStep === 2 && "Move to your RIGHT boundary and hold."}
            {calibrationStep === 3 && "Perform a JUMP and hold the peak position."}
            {calibrationStep === 4 && "CROUCH down and hold the low position."}
          </p>
          <button className="primary w-full" onClick={captureCalibration}>
            Capture {calibrationSteps[calibrationStep].toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );

  const TrainingScreen = () => {
    const [touchDir, setTouchDir] = useState<string | null>(null);
    const handleTouch = (action: Action) => {
      setTouchDir(action);
      setTimeout(() => setTouchDir(null), 150);
      engineRef.current?.handleManualInput(action);
    };
    return (
      <div className="flex flex-col h-full relative">
        <div className="flex justify-between items-center p-4 border-b border-border bg-bg-elevated">
          <div className="flex gap-4 text-sm">
            <span>TIME: <span className="text-accent">{liveStats ? `${Math.floor(liveStats.timeElapsed / 60)}:${String(liveStats.timeElapsed % 60).padStart(2, "0")}` : "0:00"}</span></span>
            <span>SCORE: <span className="text-accent">{liveStats?.score ?? 0}</span></span>
            <span>ACC: <span className="text-accent">{liveStats ? Math.round(liveStats.accuracy) : 0}%</span></span>
          </div>
          <div className="flex gap-4 text-sm">
            <span>DIFF: <span className="text-accent">{liveStats?.difficulty ?? 1}/10</span></span>
            <span>STREAK: <span className="text-accent">{liveStats?.currentStreak ?? 0}</span></span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center relative">
          {engineState === "countdown" && (
            <div className="text-8xl font-black text-accent animate-pulse">{countdown > 0 ? countdown : "GO"}</div>
          )}
          {engineState === "waiting" && (
            <div className="text-2xl text-text-muted">Get ready...</div>
          )}
          {currentSignal && (
            <div className="flex flex-col items-center animate-slide-in">
              {currentSignal.type === "COLOR" && (
                <div className={`text-9xl font-black signal-${currentSignal.color?.toLowerCase()}`}>{currentSignal.value}</div>
              )}
              {currentSignal.type === "ARROW" && (
                <div className="text-9xl font-black text-white">{currentSignal.value}</div>
              )}
              {currentSignal.type === "TEXT" && (
                <div className="text-7xl font-black text-white">{currentSignal.value}</div>
              )}
              {currentSignal.type === "PERIPHERAL" && (
                <div className={`text-7xl font-black text-white absolute ${currentSignal.position === "left" ? "left-8" : currentSignal.position === "right" ? "right-8" : currentSignal.position === "top" ? "top-8" : "bottom-8"}`}>
                  {currentSignal.value}
                </div>
              )}
              {currentSignal.type === "COMBINED" && (
                <div className="flex flex-col items-center gap-4">
                  <div className="text-6xl font-black text-white">{currentSignal.value}</div>
                  {currentSignal.direction && <div className="text-5xl text-text-muted">{currentSignal.direction}</div>}
                </div>
              )}
              {currentSignal.type === "AUDIO" && (
                <div className="text-6xl font-black text-accent">♪ LISTEN</div>
              )}
            </div>
          )}
          {lastTrial && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 animate-slide-in z-10">
              <div className="text-center">
                <div className={`text-6xl font-black mb-2 ${lastTrial.correct ? "text-success" : "text-danger"}`}>{lastTrial.correct ? "✓" : "✗"}</div>
                <div className="text-2xl font-bold">
                  {lastTrial.timeout ? "TOO SLOW" : lastTrial.falseStart ? "FALSE START" : lastTrial.noGoViolation ? "NO-GO VIOLATION" : lastTrial.correct ? formatMs(lastTrial.reactionTime!) : "WRONG"}
                </div>
                {lastTrial.reactionTime && lastTrial.reactionTime > 0 && (
                  <div className="text-lg text-text-muted mt-1">{formatMs(lastTrial.reactionTime)}</div>
                )}
              </div>
            </div>
          )}
        </div>
        {config.bodyMode === "DESK" && (
          <div className="p-4 border-t border-border bg-bg-elevated">
            <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto">
              <div />
              <button className={`py-6 text-xl font-bold ${touchDir === "JUMP" ? "bg-accent text-black" : ""}`} onClick={() => handleTouch("JUMP")}>↑ JUMP</button>
              <div />
              <button className={`py-6 text-xl font-bold ${touchDir === "LEFT" ? "bg-accent text-black" : ""}`} onClick={() => handleTouch("LEFT")}>← LEFT</button>
              <button className={`py-6 text-xl font-bold ${touchDir === "CROUCH" ? "bg-accent text-black" : ""}`} onClick={() => handleTouch("CROUCH")}>↓ CROUCH</button>
              <button className={`py-6 text-xl font-bold ${touchDir === "RIGHT" ? "bg-accent text-black" : ""}`} onClick={() => handleTouch("RIGHT")}>RIGHT →</button>
            </div>
            <p className="text-center text-xs text-text-muted mt-2">Or use Arrow Keys / WASD</p>
          </div>
        )}
        {config.bodyMode === "FULL_BODY" && config.cameraEnabled && (
          <div className="absolute bottom-4 right-4 w-48 aspect-video bg-black rounded border border-border overflow-hidden">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <div className="absolute bottom-1 left-1 text-[10px] text-white bg-black/50 px-1 rounded">LOCAL</div>
          </div>
        )}
        <button className="absolute top-4 right-4 text-xs bg-danger text-white px-3 py-1 rounded" onClick={stopTraining}>STOP</button>
      </div>
    );
  };

  const ResultsScreen = () => {
    if (!sessionResult) return null;
    const r = sessionResult;
    return (
      <div className="h-full overflow-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 className="text-4xl font-black text-center mb-2">SESSION COMPLETE</h2>
          <div className="text-center text-6xl font-black text-accent mb-6">{r.score}<span className="text-2xl text-text-muted">/100</span></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card text-center"><div className="text-2xl font-bold">{Math.round(r.accuracy)}%</div><div className="text-xs text-text-muted">Accuracy</div></div>
            <div className="card text-center"><div className="text-2xl font-bold">{formatMs(r.medianReaction)}</div><div className="text-xs text-text-muted">Median Reaction</div></div>
            <div className="card text-center"><div className="text-2xl font-bold">{formatMs(r.bestReaction)}</div><div className="text-xs text-text-muted">Best Reaction</div></div>
            <div className="card text-center"><div className="text-2xl font-bold">{r.falseStarts}</div><div className="text-xs text-text-muted">False Starts</div></div>
          </div>
          <div className="card">
            <h3 className="font-bold mb-4">Session Statistics</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>Total Trials: <span className="text-accent">{r.totalTrials}</span></div>
              <div>Correct: <span className="text-success">{r.correctTrials}</span></div>
              <div>Incorrect: <span className="text-danger">{r.totalTrials - r.correctTrials - r.timeouts}</span></div>
              <div>Timeouts: <span className="text-warning">{r.timeouts}</span></div>
              <div>No-Go Errors: <span className="text-danger">{r.noGoErrors}</span></div>
              <div>Consistency: <span className="text-accent">{Math.round(r.consistency)}%</span></div>
              <div>Difficulty: <span className="text-accent">{r.difficultyLevel}/10</span></div>
              {r.performanceDrop && r.performanceDrop > 20 && (
                <div className="col-span-2 text-warning">Performance dropped by {Math.round(r.performanceDrop)}%. Consider a break.</div>
              )}
            </div>
          </div>
          <div className="card">
            <h3 className="font-bold mb-4">Performance by Command</h3>
            <div className="space-y-2">
              {Object.entries(r.commandStats).map(([cmd, stats]) => (
                <div key={cmd} className="flex justify-between items-center text-sm">
                  <span className="font-mono font-bold">{cmd}</span>
                  <div className="flex gap-4">
                    <span className="text-success">{Math.round(stats.accuracy)}% acc</span>
                    <span className="text-accent">{formatMs(stats.median)}</span>
                    <span className="text-text-muted">{stats.count} trials</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h3 className="font-bold mb-4">Reaction Time Graph</h3>
            <canvas ref={(c) => {
              if (!c || !r) return;
              const ctx = c.getContext("2d");
              if (!ctx) return;
              const trials = engineRef.current?.getTrials() || [];
              const data = trials.filter(t => t.reactionTime && t.reactionTime > 0 && t.reactionTime < 3000).map(t => t.reactionTime!);
              if (data.length === 0) return;
              c.width = c.offsetWidth * 2;
              c.height = 200;
              ctx.scale(2, 2);
              ctx.clearRect(0, 0, c.width, c.height);
              const w = c.offsetWidth;
              const h = 200;
              const max = Math.max(...data, 1000);
              const min = Math.min(...data, 0);
              const range = max - min || 1;
              ctx.strokeStyle = "#00d4aa";
              ctx.lineWidth = 2;
              ctx.beginPath();
              data.forEach((val, i) => {
                const x = (i / (data.length - 1)) * w;
                const y = h - ((val - min) / range) * (h - 20) - 10;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              });
              ctx.stroke();
              ctx.fillStyle = "#00d4aa";
              data.forEach((val, i) => {
                const x = (i / (data.length - 1)) * w;
                const y = h - ((val - min) / range) * (h - 20) - 10;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
              });
            }} className="w-full h-[200px]" />
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => setScreen("mode")}>New Session</button>
            <button onClick={() => {
              const blob = new Blob([StorageManager.exportJSON()], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `reflex-x-session-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
            }}>Export JSON</button>
            <button onClick={() => {
              const blob = new Blob([StorageManager.exportCSV()], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `reflex-x-session-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
            }}>Export CSV</button>
          </div>
        </div>
      </div>
    );
  };

  const HistoryScreen = () => (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-3xl font-bold">Session History</h2>
          <button onClick={() => setScreen("mode")}>← Back</button>
        </div>
        {history.length === 0 ? (
          <p className="text-text-muted text-center py-12">No sessions yet.</p>
        ) : (
          <div className="space-y-3">
            {history.map((h) => (
              <div key={h.id} className="card flex justify-between items-center">
                <div>
                  <div className="font-bold">{h.mode.replace(/_/g, " ")}</div>
                  <div className="text-xs text-text-muted">{new Date(h.date).toLocaleString()}</div>
                </div>
                <div className="flex gap-4 text-sm">
                  <span className="text-accent">{h.score}/100</span>
                  <span className="text-success">{Math.round(h.accuracy)}%</span>
                  <span className="text-text-muted">{formatMs(h.medianReaction)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-6">
          <h3 className="font-bold mb-2">Personal Records</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="card">Fastest: <span className="text-accent">{records.fastestReaction < 9999 ? formatMs(records.fastestReaction) : "—"}</span></div>
            <div className="card">Best Accuracy: <span className="text-accent">{records.bestAccuracy > 0 ? `${records.bestAccuracy}%` : "—"}</span></div>
            <div className="card">Highest Score: <span className="text-accent">{records.highestScore > 0 ? records.highestScore : "—"}</span></div>
            <div className="card">Best Streak: <span className="text-accent">{records.longestStreak}</span></div>
          </div>
        </div>
      </div>
    </div>
  );

  const SettingsScreen = () => (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-3xl font-bold">Settings</h2>
          <button onClick={() => setScreen("mode")}>← Back</button>
        </div>
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-bold mb-3">Reset Data</h3>
            <div className="flex gap-2 flex-wrap">
              <button className="danger text-sm" onClick={() => { if (confirm("Reset all history?")) { StorageManager.reset("history"); setHistory([]); } }}>Reset History</button>
              <button className="danger text-sm" onClick={() => { if (confirm("Reset calibration?")) { StorageManager.reset("calibration"); setCalibrationData(null); } }}>Reset Calibration</button>
              <button className="danger text-sm" onClick={() => { if (confirm("Reset EVERYTHING?")) { StorageManager.reset("all"); setHistory([]); setCalibrationData(null); } }}>Reset All</button>
            </div>
          </div>
          <div className="card">
            <h3 className="font-bold mb-3">Camera Confidence Threshold</h3>
            <p className="text-sm text-text-muted mb-2">Minimum confidence to register movement</p>
            <div className="flex gap-2">
              {[60, 70, 80, 90].map((v) => (
                <button key={v} className="text-sm" onClick={() => classifierRef.current.setConfidenceThreshold(v / 100)}>{v}%</button>
              ))}
            </div>
          </div>
          <div className="card">
            <h3 className="font-bold mb-3">Privacy</h3>
            <p className="text-sm text-text-muted">Camera processing is performed locally in your browser. No video is uploaded to any server. No account is required.</p>
          </div>
          <div className="card">
            <h3 className="font-bold mb-3">Debug</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} />
              <span>Show camera debug overlay</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full w-full bg-bg text-text">
      {screen === "welcome" && <WelcomeScreen />}
      {screen === "mode" && <ModeScreen />}
      {screen === "config" && <ConfigScreen />}
      {screen === "safety" && <SafetyScreen />}
      {screen === "calibration" && <CalibrationScreen />}
      {screen === "training" && <TrainingScreen />}
      {screen === "results" && <ResultsScreen />}
      {screen === "history" && <HistoryScreen />}
      {screen === "settings" && <SettingsScreen />}
    </div>
  );
}
