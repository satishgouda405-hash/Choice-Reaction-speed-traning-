import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, RotateCcw, Settings, Activity, Shield, Award, Volume2, VolumeX, Eye, Flame, AlertTriangle, Monitor, User, CheckCircle2, XCircle, Clock, Zap } from 'lucide-react';
import { TrainingEngine } from './engine/TrainingEngine';
import { PoseDetector } from './camera/PoseDetector';
import { MovementClassifier } from './camera/MovementClassifier';
import { AudioEngine } from './audio/AudioEngine';
import { StorageManager } from './storage/StorageManager';
import { TrainingMode, TrainingConfig, Action, MovementEvent, DetectionDiagnostics } from './types';

export function App() {
  const [config, setConfig] = useState<TrainingConfig>({
    mode: 'COLOR',
    difficulty: 5,
    sessionDurationSeconds: 180,
    sessionType: 'TIME',
    trialCount: 20,
    cameraEnabled: true,
    audioEnabled: true,
    movementMode: 'FULL_BODY',
    cameraConfidenceThreshold: 0.75,
    randomizationLevel: 'HIGH',
    customCommands: []
  });

  const [engineState, setEngineState] = useState<ReturnType<TrainingEngine['getState']>>({
    status: 'IDLE',
    currentTrial: null,
    score: 0,
    accuracy: 100,
    trialCount: 0,
    correctCount: 0,
    incorrectCount: 0,
    timeoutCount: 0,
    falseStartCount: 0,
    noGoErrorCount: 0,
    medianReactionMs: 0,
    bestReactionMs: 0,
    currentStreak: 0,
    timeRemainingSeconds: 180,
    difficulty: 5
  });

  const [calibrated, setCalibrated] = useState(false);
  const [calibrationStep, setCalibrationStep] = useState<number>(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DetectionDiagnostics | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [sessionHistory, setSessionHistory] = useState(StorageManager.getHistory());
  const [activeTab, setActiveTab] = useState<'TRAIN' | 'SETTINGS' | 'STATS' | 'CALIBRATION'>('TRAIN');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<TrainingEngine | null>(null);
  const poseDetectorRef = useRef<PoseDetector | null>(null);
  const classifierRef = useRef<MovementClassifier | null>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);

  useEffect(() => {
    audioEngineRef.current = new AudioEngine();
    classifierRef.current = new MovementClassifier();
    engineRef.current = new TrainingEngine(config, (state) => {
      setEngineState(state);
    });

    const storedCal = StorageManager.getCalibration();
    if (storedCal) {
      classifierRef.current.setCalibration(storedCal);
      setCalibrated(true);
    }

    return () => {
      engineRef.current?.destroy();
      poseDetectorRef.current?.stop();
    };
  }, []);

  const handleAction = useCallback((action: Action) => {
    if (!engineRef.current) return;
    const event: MovementEvent = {
      type: action,
      timestamp: performance.now(),
      confidence: 1.0
    };
    engineRef.current.processMovement(event);
  }, []);

  const handlePoseDetected = useCallback((landmarks: any) => {
    if (!classifierRef.current || !engineRef.current) return;

    const event = classifierRef.current.classify(landmarks);
    if (event && event.confidence >= config.cameraConfidenceThreshold) {
      engineRef.current.processMovement(event);
    }

    setDiagnostics({
      fps: poseDetectorRef.current?.getFPS() || 0,
      inferenceMs: poseDetectorRef.current?.getInferenceTime() || 0,
      confidence: event?.confidence || 0,
      detectedAction: event?.type || 'NO_ACTION'
    });
  }, [config.cameraConfidenceThreshold]);

  const startCamera = async () => {
    if (!videoRef.current) return;
    try {
      poseDetectorRef.current = new PoseDetector(videoRef.current, handlePoseDetected);
      await poseDetectorRef.current.start();
      setCameraActive(true);
    } catch (err) {
      console.error('Failed to start camera:', err);
      setCameraActive(false);
    }
  };

  const startSession = async () => {
    if (config.cameraEnabled && !cameraActive) {
      await startCamera();
    }
    engineRef.current?.configure(config);
    engineRef.current?.startSession();
  };

  const stopSession = () => {
    engineRef.current?.stopSession();
    setSessionHistory(StorageManager.getHistory());
  };

  const resetSession = () => {
    engineRef.current?.reset();
  };

  const runCalibrationStep = () => {
    if (calibrationStep === 0) {
      setCalibrationStep(1);
    } else if (calibrationStep === 1) {
      setCalibrationStep(2);
    } else if (calibrationStep === 2) {
      setCalibrationStep(3);
    } else if (calibrationStep === 3) {
      setCalibrationStep(4);
    } else {
      setCalibrated(true);
      setCalibrationStep(0);
      if (classifierRef.current) {
        StorageManager.saveCalibration(classifierRef.current.getCalibration());
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-cyan-500/10 border border-cyan-500/30 p-2 rounded-lg text-cyan-400">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-mono text-xl font-bold tracking-wider text-slate-100 flex items-center gap-2">
              REFLEX<span className="text-cyan-400">//</span>X
            </h1>
            <p className="text-xs text-slate-400">Solo Reaction & Movement System</p>
          </div>
        </div>

        <nav className="flex items-center gap-1 bg-slate-900/80 p-1 border border-slate-800 rounded-lg">
          {(['TRAIN', 'CALIBRATION', 'SETTINGS', 'STATS'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-md text-xs font-mono transition-all ${
                activeTab === tab
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-lg shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="relative aspect-video bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden flex flex-col items-center justify-center p-6 shadow-2xl">
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none" autoPlay playsInline muted />

            {engineState.status === 'RUNNING' && engineState.currentTrial && (
              <div className="z-10 flex flex-col items-center justify-center space-y-4 animate-in fade-in duration-100">
                <span className="text-xs font-mono uppercase tracking-widest text-slate-400">Current Signal</span>
                <div
                  className="px-12 py-8 rounded-2xl border text-center transition-all shadow-2xl"
                  style={{
                    backgroundColor: engineState.currentTrial.signal.color || '#1e293b',
                    borderColor: 'rgba(255,255,255,0.2)'
                  }}
                >
                  <h2 className="text-5xl font-black text-white tracking-wider drop-shadow-md">
                    {engineState.currentTrial.signal.text || engineState.currentTrial.signal.type}
                  </h2>
                </div>
                <p className="text-sm font-mono text-cyan-400">Expected: {engineState.currentTrial.expectedAction}</p>
              </div>
            )}

            {engineState.status === 'IDLE' && (
              <div className="z-10 text-center space-y-4 max-w-md">
                <div className="inline-flex p-3 rounded-full bg-cyan-500/10 text-cyan-400 mb-2">
                  <Activity className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-slate-100">Ready to Train</h3>
                <p className="text-sm text-slate-400">Select your configuration and start the session to test your reaction time and spatial agility.</p>
                <button
                  onClick={startSession}
                  className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg transition-all shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
                >
                  <Play className="w-5 h-5 fill-current" />
                  Start Training Session
                </button>
              </div>
            )}

            {engineState.status === 'FINISHED' && (
              <div className="z-10 text-center space-y-4 max-w-md">
                <div className="inline-flex p-3 rounded-full bg-emerald-500/10 text-emerald-400 mb-2">
                  <Award className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-bold text-slate-100">Session Complete!</h3>
                <div className="grid grid-cols-2 gap-3 text-left bg-slate-950/60 p-4 rounded-lg border border-slate-800">
                  <div>
                    <span className="text-xs text-slate-500 block">Score</span>
                    <span className="text-xl font-mono font-bold text-cyan-400">{engineState.score}</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">Accuracy</span>
                    <span className="text-xl font-mono font-bold text-emerald-400">{engineState.accuracy.toFixed(1)}%</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">Median Reaction</span>
                    <span className="text-xl font-mono font-bold text-slate-200">{engineState.medianReactionMs} ms</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">Best Reaction</span>
                    <span className="text-xl font-mono font-bold text-amber-400">{engineState.bestReactionMs} ms</span>
                  </div>
                </div>
                <button
                  onClick={startSession}
                  className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg transition-all shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-5 h-5" />
                  Train Again
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'JUMP', action: 'JUMP' as Action, color: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' },
              { label: 'CROUCH', action: 'CROUCH' as Action, color: 'bg-amber-500/10 border-amber-500/30 text-amber-400' },
              { label: 'LEFT', action: 'LEFT' as Action, color: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
              { label: 'RIGHT', action: 'RIGHT' as Action, color: 'bg-purple-500/10 border-purple-500/30 text-purple-400' }
            ].map((btn) => (
              <button
                key={btn.label}
                onClick={() => handleAction(btn.action)}
                className={`p-4 border rounded-xl font-mono font-bold transition-all active:scale-95 flex flex-col items-center justify-center gap-1 ${btn.color}`}
              >
                <span className="text-xs opacity-60">Manual Action</span>
                <span>{btn.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="font-mono text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2">Session Telemetry</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80">
                <span className="text-xs text-slate-500 block">Accuracy</span>
                <span className="text-2xl font-mono font-bold text-emerald-400">{engineState.accuracy.toFixed(0)}%</span>
              </div>
              <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80">
                <span className="text-xs text-slate-500 block">Streak</span>
                <span className="text-2xl font-mono font-bold text-cyan-400">{engineState.currentStreak}</span>
              </div>
              <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80">
                <span className="text-xs text-slate-500 block">Median RT</span>
                <span className="text-2xl font-mono font-bold text-slate-200">{engineState.medianReactionMs}<span className="text-xs text-slate-500"> ms</span></span>
              </div>
              <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80">
                <span className="text-xs text-slate-500 block">Time Left</span>
                <span className="text-2xl font-mono font-bold text-amber-400">{engineState.timeRemainingSeconds}<span className="text-xs text-slate-500"> s</span></span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4 flex-1">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="font-mono text-xs uppercase tracking-wider text-slate-400">Mode Settings</h3>
              <Settings className="w-4 h-4 text-slate-500" />
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Training Mode</label>
                <select
                  value={config.mode}
                  onChange={(e) => setConfig({ ...config, mode: e.target.value as TrainingMode })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-sm text-slate-200 font-mono"
                >
                  <option value="COLOR">Color Reaction</option>
                  <option value="DIRECTION">Direction Reaction</option>
                  <option value="GO_NOGO">Go / No-Go</option>
                  <option value="CHAOS">Chaos Mode</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Difficulty Level: {config.difficulty}</label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={config.difficulty}
                  onChange={(e) => setConfig({ ...config, difficulty: parseInt(e.target.value, 10) })}
                  className="w-full accent-cyan-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-between border-t border-slate-800">
                <span className="text-xs text-slate-400">Camera Detection</span>
                <button
                  onClick={() => setConfig({ ...config, cameraEnabled: !config.cameraEnabled })}
                  className={`px-3 py-1 rounded text-xs font-mono font-bold ${config.cameraEnabled ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-slate-800 text-slate-500'}`}
                >
                  {config.cameraEnabled ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
