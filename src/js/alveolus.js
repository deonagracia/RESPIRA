/**
 * alveolus.js — Phase 2
 * -----------------------------------------------------------------------
 * Drives the microscopic-view particle animation from the simulation's
 * actual airflow, instead of the idle/decorative animation used in
 * Phase 1. This intentionally stops short of a real gas-exchange model
 * (no partial pressures, no diffusion equations) — it is a proportional,
 * illustrative mapping from "how much air is currently moving" to "how
 * fast the O2/CO2 particles appear to move", which is enough to make the
 * microscopic view feel connected to the simulation without overstating
 * what is being modeled.
 */

const DEFAULT_PEAK_REFERENCE_LMIN = 40;

/**
 * Normalize an airflow reading (L/min, positive or negative) into a 0..1
 * "ventilation intensity" used to drive animation speed/opacity.
 * @param {number} airflowLmin
 * @param {number} [peakReference=40] - L/min treated as "fast" (clamped to 1)
 * @returns {number} 0..1
 */
export function ventilationIntensity(airflowLmin, peakReference = DEFAULT_PEAK_REFERENCE_LMIN) {
  if (!Number.isFinite(airflowLmin)) return 0;
  return Math.min(1, Math.abs(airflowLmin) / peakReference);
}

/**
 * Map a 0..1 ventilation intensity to a CSS animation-duration multiplier:
 * higher intensity -> shorter duration -> particles appear to move faster.
 * Kept within a sane range so particles never fully stop or spin unusably fast.
 * @param {number} intensity 0..1
 * @returns {number} multiplier, roughly 0.35 (fast) .. 2.2 (slow/idle)
 */
export function particleDurationScale(intensity) {
  const clamped = Math.min(1, Math.max(0, intensity));
  return 2.2 - clamped * 1.85;
}

/**
 * Map a 0..1 ventilation intensity to a 0..1 opacity/glow amount for the
 * O2/CO2 particle groups, so a genuinely apneic moment (near-zero airflow)
 * visibly dims the exchange activity rather than only speeding/slowing it.
 * @param {number} intensity 0..1
 * @returns {number} 0..1
 */
export function particleActivity(intensity) {
  const clamped = Math.min(1, Math.max(0, intensity));
  return 0.35 + clamped * 0.65;
}

export default { ventilationIntensity, particleDurationScale, particleActivity };
