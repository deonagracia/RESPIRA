/**
 * simHistory.js — Phase 2
 * -----------------------------------------------------------------------
 * A small shared recorder for the current/most recent simulation run. The
 * Simulation page (simulation.js) writes one sample here per published
 * tick; the Analysis page (analysis.js) reads it back — statically — to
 * populate the System Response stat grid and the four result charts.
 *
 * This lives outside state.js on purpose: state.js holds low-frequency
 * "current value" fields (good for reactive UI text/labels), while this
 * module holds the append-only time-series log that only Analysis needs
 * to iterate over in bulk. Keeping them separate avoids pushing large
 * arrays through every state.js subscriber on every tick.
 */

let samples = [];
let statsCache = null;
let statsCacheKey = null;

/**
 * @typedef {object} Sample
 * @property {number} t - seconds since the run started
 * @property {number} target - target pressure, cmH2O
 * @property {number} actual - actual pressure, cmH2O
 * @property {number} error - target - actual, cmH2O
 * @property {number} flow - airflow, L/min
 * @property {number} blower - blower output, 0..100
 * @property {number} obstruction - 0..100
 */

/** @param {Sample} sample */
export function recordSample(sample) {
  samples.push(sample);
  statsCache = null;
}

/** @returns {Sample[]} */
export function getSamples() {
  return samples;
}

export function hasData() {
  return samples.length > 0;
}

export function clearHistory() {
  samples = [];
  statsCache = null;
  statsCacheKey = null;
}
/**
 * Compute summary statistics for the recorded run. Cached until the next
 * recordSample()/clearHistory() call.
 * @returns {null | {
 *   maxError:number, lateMaxError:number, peakBlower:number, avgFlow:number,
 *   settlingTime:number|null, finalActual:number, finalTarget:number,
 *   durationSec:number, sampleCount:number
 * }}
 */
export function computeStats() {
  if (!samples.length) return null;
  if (statsCache && statsCacheKey === samples.length) return statsCache;

  let maxError = 0;
  let peakBlower = 0;
  let sumAbsFlow = 0;

  for (const s of samples) {
    maxError = Math.max(maxError, Math.abs(s.error));
    peakBlower = Math.max(peakBlower, s.blower);
    sumAbsFlow += Math.abs(s.flow);
  }

  // Max error over just the last third of the run — a better proxy for
  // "how much does it still oscillate once past the unavoidable startup
  // transient" than the whole-run max, which is almost always dominated
  // by the initial rise from 0 toward the target.
  const lateStartIndex = Math.floor(samples.length * (2 / 3));
  let lateMaxError = 0;
  for (let i = lateStartIndex; i < samples.length; i++) {
    lateMaxError = Math.max(lateMaxError, Math.abs(samples[i].error));
  }

  const avgFlow = sumAbsFlow / samples.length;
  const finalTarget = samples[samples.length - 1].target;
  const tolerance = Math.max(0.3, finalTarget * 0.05);

  // Settling time: walk back from the end to find the last moment the
  // error was outside the tolerance band. Everything after that point
  // stayed settled through the end of the recorded run.
  let settleIndex = 0;
  let everSettled = false;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (Math.abs(samples[i].error) > tolerance) {
      settleIndex = i + 1;
      everSettled = settleIndex < samples.length;
      break;
    }
    everSettled = true;
    settleIndex = 0;
  }

  const settlingTime = everSettled
    ? samples[Math.min(settleIndex, samples.length - 1)].t - samples[0].t
    : null;

  statsCache = {
    maxError,
    lateMaxError,
    peakBlower,
    avgFlow,
    settlingTime,
    finalActual: samples[samples.length - 1].actual,
    finalTarget,
    durationSec: samples[samples.length - 1].t - samples[0].t,
    sampleCount: samples.length
  };
  statsCacheKey = samples.length;
  return statsCache;
}

export default { recordSample, getSamples, hasData, clearHistory, computeStats };
