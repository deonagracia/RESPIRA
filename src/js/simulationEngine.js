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
 *  - drive the "Sleep Simulation" auto-obstruction pattern and restore the
 *    user's manual obstruction value when sleep mode ends
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
 * functions this module exports (resetRun, requestSleepToggle).
 */

import { getState, setState } from './state.js';
import { emit } from './bus.js';
import { RespiratoryModel } from './respiratoryModel.js';
import { PIDController } from './pidController.js';
import * as simHistory from './simHistory.js';

const FIXED_DT = 0.02; // seconds — physics integration step (50 Hz)
const PUBLISH_INTERVAL = 0.08; // seconds — telemetry/history/chart publish rate (~12.5 Hz)
const MAX_FRAME_DT = 0.25; // seconds — clamp huge gaps (tab switches, GC pauses)
const MAX_STEPS_PER_FRAME = 200; // safety cap so a long stall can't freeze the tab

const model = new RespiratoryModel();
const pid = new PIDController({ outMin: 0, outMax: 100 });

let started = false;
let lastFrameTime = null;
let physicsAccumulator = 0;
let publishAccumulator = 0;

let simClock = 0;
let sleepClock = 0;
let wasCpapOn = false;
let prevStatus = 'idle';
let manualObstructionBeforeSleep = null;
let lastTick = null;

/**
 * A scripted overnight obstruction pattern for "Sleep Simulation": mild
 * baseline narrowing punctuated by repeating obstructive events that ramp
 * up, hold, and release — a simplified stand-in for an apnea/hypopnea
 * cycle. Drives the same `obstruction` value the manual slider would.
 * @param {number} tSec - seconds since sleep mode was activated
 */
function sleepObstructionPattern(tSec) {
  const period = 42; // seconds per cycle
  const t = tSec % period;
  const baseline = 15;
  const peak = 88;

  if (t < 10) return baseline; // quiet breathing
  if (t < 18) return baseline + (peak - baseline) * ((t - 10) / 8); // airway collapsing
  if (t < 28) return peak; // obstructive event held
  if (t < 34) return peak - (peak - baseline) * ((t - 28) / 6); // airway reopening
  return baseline; // recovery breathing
}

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
  simHistory.clearHistory();
  simClock = 0;
  sleepClock = 0;
  manualObstructionBeforeSleep = null;
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

  const isActive = status === 'running' || status === 'sleep';
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

/** Detect entering/leaving Sleep mode so the manual obstruction value can be captured/restored. */
function watchStatusTransition(status) {
  if (status === prevStatus) return;

  if (status === 'sleep' && prevStatus !== 'sleep') {
    manualObstructionBeforeSleep = getState().obstruction;
    sleepClock = 0;
  } else if (prevStatus === 'sleep' && status !== 'sleep') {
    if (manualObstructionBeforeSleep != null) {
      setState({ obstruction: manualObstructionBeforeSleep });
    }
    manualObstructionBeforeSleep = null;
  }

  prevStatus = status;
}

function tickPhysics(dt, status) {
  const s = getState();

  if (s.cpapOn && !wasCpapOn) pid.reset();
  wasCpapOn = s.cpapOn;
  pid.setGains({ kp: s.kp, ki: s.ki, kd: s.kd });

  let obstruction = s.obstruction;
  if (status === 'sleep') {
    sleepClock += dt;
    obstruction = sleepObstructionPattern(sleepClock);
    if (Math.abs(obstruction - s.obstruction) > 0.05) {
      setState({ obstruction });
    }
  }

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

  lastTick = {
    t: simClock,
    target: s.targetPressure,
    actual: result.pressure,
    error: s.targetPressure - result.pressure,
    flow: result.flow,
    blower: blowerOutput,
    resistance: result.resistance,
    obstruction
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
    error: lastTick.error
  });
  
  simHistory.recordSample({ ...lastTick });
  emit('sim:tick', { ...lastTick });
}

export default { initEngine, resetRun };
