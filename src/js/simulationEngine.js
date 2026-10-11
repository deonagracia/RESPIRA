/**
 * simulationEngine.js — Phase 2
 * -----------------------------------------------------------------------
 * The persistent simulation loop. Unlike the Three.js scenes and charts
 * (which are owned by whichever page mounts them, and stop when that page
 * unmounts), the physics engine is a singleton started once from
 * `main.js` and keeps running for the lifetime of the app — navigating
 * away from the Simulation page does NOT pause a running simulation,
 * exactly like leaving an instrument running in a real lab.
 *
 * Responsibilities:
 *  - own the RespiratoryModel + PIDController instances and step them on
 *    a fixed physics timestep (accumulator pattern, independent of frame rate)
 *  - run the breath analyzer (VT, RR, apnea/hypopnea detection, AHI)
 *  - publish telemetry to state.js (for reactive stat tiles/chips
 *    anywhere in the app) and to simHistory.js (for the Analyze page), at
 *    a throttled rate
 *  - emit a `sim:tick` bus event with each published sample so any
 *    currently-mounted page (the live charts on the Simulation page, the
 *    ventilation-driven animation on the Microscopic page) can react
 *    without needing a direct reference to the engine
 *
 * Pages never import RespiratoryModel/PIDController directly — they only
 * read state.js, listen for `sim:tick`, and call the small control
 * functions this module exports (resetRun, getBreathSummary).
 */

import { getState, setState } from './state.js';
import { emit } from './bus.js';
import { RespiratoryModel } from './respiratoryModel.js';
import { PIDController } from './pidController.js';
import { BreathAnalyzer } from './breathAnalyzer.js';
import * as simHistory from './simHistory.js';

const FIXED_DT = 0.02; // seconds — physics integration step (50 Hz)
const PUBLISH_INTERVAL = 0.04; // seconds — 25 Hz, cukup rapat agar puncak aliran tidak terpotong
const MAX_FRAME_DT = 0.25; // seconds — clamp huge gaps (tab switches, GC pauses)
const MAX_STEPS_PER_FRAME = 200; // safety cap so a long stall can't freeze the tab

const model = new RespiratoryModel();
const pid = new PIDController({ outMin: 0, outMax: 100 });
const analyzer = new BreathAnalyzer();

let started = false;
let lastFrameTime = null;
let physicsAccumulator = 0;
let publishAccumulator = 0;

let simClock = 0;
let wasCpapOn = false;
let prevStatus = 'idle';
let lastTick = null;

/** Start the persistent engine loop. Safe to call more than once — only the first call takes effect. */
export function initEngine() {
  if (started) return;
  started = true;
  wasCpapOn = getState().cpapOn;
  prevStatus = getState().simStatus;
  requestAnimationFrame(loop);
}

/** Fully clear the current run: plant, controller, recorded history, and the simulation clock. */
export function resetRun() {
  model.reset();
  pid.reset();
  analyzer.reset();
  simHistory.clearHistory();
  simClock = 0;
  publishAccumulator = 0;
  lastTick = null;
}

function loop(now) {
  requestAnimationFrame(loop);

  if (lastFrameTime == null) {
    lastFrameTime = now;
    return;
  }

  let frameDt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  if (frameDt > MAX_FRAME_DT) frameDt = MAX_FRAME_DT;

  const status = getState().simStatus;
  watchStatusTransition(status);

  const isActive = status === 'running';
  if (!isActive) return;

  physicsAccumulator += frameDt;
  publishAccumulator += frameDt;

  let steps = 0;
  while (physicsAccumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    tickPhysics(FIXED_DT, status);
    physicsAccumulator -= FIXED_DT;
    steps += 1;
  }

  if (publishAccumulator >= PUBLISH_INTERVAL) {
    publishAccumulator = 0;
    publishTelemetry();
  }
}

function watchStatusTransition(status) {
  prevStatus = status;
}

function tickPhysics(dt, status) {
  const s = getState();

  if (s.cpapOn && !wasCpapOn) pid.reset();
  wasCpapOn = s.cpapOn;
  pid.setGains({ kp: s.kp, ki: s.ki, kd: s.kd });

  const obstruction = s.obstruction;

  simClock += dt;

  const currentError = s.targetPressure - model.pressure;
  const blowerOutput = s.cpapOn ? pid.update(currentError, dt) : 0;

  const result = model.step(dt, {
    obstruction,
    respRate: s.respRate,
    simTime: simClock,
    blowerOutput,
    cpapOn: s.cpapOn
  });

  analyzer.step({ t: simClock, volume: result.volume, pmus: result.pmus, spo2: result.spo2, aroused: result.aroused });

  lastTick = {
    t: simClock,
    target: s.targetPressure,
    actual: result.pressure,
    error: s.targetPressure - result.pressure,
    flow: result.flow,
    blower: blowerOutput,
    resistance: result.resistance,
    obstruction,
    volume: result.volume, // L absolut — untuk grafik volume–waktu (spirogram)
    tidalDelta: result.tidalDelta, // L di atas FRC — untuk animasi paru 3D
    patency: result.patency, // 0..1 bukaan faring
    effectiveObstruction: result.effectiveObstruction, // % obstruksi efektif setelah CPAP
    pcrit: result.pcrit,
    pmus: result.pmus,
    spo2: result.spo2,
    ve: result.ve,
    inEvent: analyzer.current != null, // sedang dalam kejadian apnea/hipopnea
    aroused: result.aroused, // pasien sedang terbangun sejenak (arousal)
    cpapOn: s.cpapOn
  };
}

function publishTelemetry() {
  if (!lastTick) return;
  
  // Pastikan nilai tidak NaN atau Infinity untuk mencegah crash pada grafik
  if (Number.isNaN(lastTick.actual) || !Number.isFinite(lastTick.actual)) lastTick.actual = 0;
  if (Number.isNaN(lastTick.flow) || !Number.isFinite(lastTick.flow)) lastTick.flow = 0;
  if (Number.isNaN(lastTick.blower) || !Number.isFinite(lastTick.blower)) lastTick.blower = 0;
  if (Number.isNaN(lastTick.error) || !Number.isFinite(lastTick.error)) lastTick.error = 0;

  setState({
    actualPressure: lastTick.actual,
    airflow: lastTick.flow,
    resistance: lastTick.resistance,
    blowerOutput: lastTick.blower,
    error: lastTick.error,
    lungVolume: lastTick.volume,
    spo2: lastTick.spo2,
    minuteVentilation: lastTick.ve,
    effectiveObstruction: lastTick.effectiveObstruction,
    pcrit: lastTick.pcrit,
    aroused: lastTick.aroused,
    ...breathSummary()
  });
  
  simHistory.recordSample({ ...lastTick });
  emit('sim:tick', { ...lastTick });
}

function breathSummary() {
  const b = analyzer.snapshot(simClock);
  return {
    tidalVolume: b.vt, // L per napas
    measuredRR: b.rr, // napas efektif per menit
    apneaCount: b.apneaCount,
    hypopneaCount: b.hypopneaCount,
    ahi: b.ahi,
    spo2Min: b.spo2Min,
    osaEvents: b.events.slice(), // [{type, start, end}] — penanda di grafik
    currentEventSec: b.currentEventSec,
    currentEventType: b.currentEventType,
    pendingCount: b.pendingCount
  };
}

/** Ringkasan analisis napas untuk halaman Analyze. */
export function getBreathSummary() {
  return breathSummary();
}

export default { initEngine, resetRun, getBreathSummary };
