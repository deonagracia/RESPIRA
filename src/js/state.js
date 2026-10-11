/**
 * state.js
 * -----------------------------------------------------------------------
 * A tiny centralized state store, shared by every page.
 *
 * Two kinds of fields live here:
 *  - Control fields (cpapOn, simStatus, obstruction, targetPressure,
 *    respRate, kp/ki/kd) — set directly by the user via the Simulation
 *    page's controls. These existed since Phase 1.
 *  - Telemetry fields (actualPressure, airflow, resistance, blowerOutput,
 *    error) — added in Phase 2. They are written once per published tick
 *    by the simulation engine in simulation.js (see respiratoryModel.js /
 *    pidController.js), and read reactively by stat tiles, status chips,
 *    and the microscopic view. They stay `null` until a simulation has
 *    actually been started at least once.
 *
 * The full per-tick time series (used for the Analysis page's charts and
 * summary stats) is NOT kept here — see simHistory.js for that.
 */

const defaultState = Object.freeze({
  // Lab control state
  cpapOn: false,
  simStatus: 'idle', // 'idle' | 'running' | 'paused' | 'sleep'

  // Scenario controls (0..100 / physical units)
  obstruction: 20, // percent, 0 = fully open, 100 = fully occluded
  targetPressure: 8, // cmH2O
  respRate: 14, // breaths per minute

  // PID gains — read by pidController.js on every tick
  kp: 4.5,
  ki: 1.4,
  kd: 0.08,

  // Live telemetry, published by the simulation engine (null until Start is pressed at least once)
  actualPressure: null, // cmH2O
  airflow: null, // L/min
  resistance: null, // cmH2O·s/L
  blowerOutput: null, // 0..100
  error: null, // cmH2O (target - actual)
  lungVolume: null, // L, volume paru absolut
  spo2: null, // %
  minuteVentilation: null, // L/min
  effectiveObstruction: null, // %, obstruksi faring efektif (setelah efek CPAP)

  // Navigation / mode flags
  microscopicMode: false
});

let state = { ...defaultState };
const listeners = new Set();

/** Get a shallow copy of the current state. */
export function getState() {
  return { ...state };
}

/**
 * Merge a partial patch into the state and notify subscribers.
 * @param {Partial<typeof defaultState>} patch
 */
export function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(getState()));
}

/** Reset the store back to its Phase 1 defaults. */
export function resetState() {
  state = { ...defaultState };
  listeners.forEach((fn) => fn(getState()));
}

/**
 * Subscribe to state changes. The handler is invoked immediately with the
 * current state, then again on every setState() call.
 * @param {(state: typeof defaultState) => void} fn
 * @returns {() => void} unsubscribe function
 */
export function subscribe(fn) {
  listeners.add(fn);
  fn(getState());
  return () => listeners.delete(fn);
}

export default { getState, setState, resetState, subscribe };
