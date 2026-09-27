/**
 * respiratoryModel.js — Phase 2
 * -----------------------------------------------------------------------
 * A deliberately simple, single-compartment RC (resistance/compliance)
 * model of the airway + lung, driven by the CPAP blower and by the
 * patient's own spontaneous breathing effort. It is the "plant" the PID
 * controller in pidController.js tries to control.
 *
 * Equation of motion (electrical-circuit analogy: R = resistor,
 * C = capacitor, driving pressure = voltage source):
 *
 *   flow      Q(t) = (drive(t) - P(t)) / R(t)      [L/s]
 *   pressure  dP/dt = Q(t) / C                      [cmH2O/s]
 *
 * where:
 *   - drive(t)  = CPAP blower contribution + spontaneous patient effort
 *   - P(t)      = "Actual Pressure" at the airway/mask (the controlled variable)
 *   - R(t)      = "Airway Resistance", rises sharply as obstruction -> 100%
 *   - C         = lung/circuit compliance (held constant in Phase 2)
 *
 * This is intentionally NOT a clinically validated respiratory model — it
 * is tuned to *look and behave* like a textbook control-systems plant
 * (first-order lag with a nonlinear, disturbance-driven time constant) so
 * the PID controller has something meaningful to fight against, which is
 * the actual learning objective of this simulator (Section 12 of the
 * project brief: natural vs artificial feedback control).
 */

export const PHYSIOLOGY = Object.freeze({
  R_BASE: 5, // cmH2O·s/L — airway resistance with no obstruction
  R_OBSTRUCTED_MAX: 45, // additional resistance contributed at 100% obstruction
  COMPLIANCE: 0.3, // L/cmH2O — lung/circuit compliance (constant in Phase 2)
  BLOWER_MAX_PRESSURE: 25, // cmH2O — driving pressure at 100% blower output
  PATIENT_EFFORT_AMPLITUDE: 2.2 // cmH2O — spontaneous inspiratory effort pulse height
});

/**
 * Airway resistance as a function of obstruction percentage.
 * Nonlinear (quadratic) on purpose: resistance stays fairly manageable
 * until obstruction gets severe, then rises sharply — closer to how a
 * real collapsing upper airway behaves than a straight line would be.
 * @param {number} obstructionPct 0..100
 * @returns {number} resistance in cmH2O·s/L
 */
export function resistanceFromObstruction(obstructionPct) {
  const frac = Math.min(100, Math.max(0, obstructionPct)) / 100;
  return PHYSIOLOGY.R_BASE + PHYSIOLOGY.R_OBSTRUCTED_MAX * frac * frac;
}

/**
 * The spontaneous patient respiratory effort, modeled as a half-sine
 * inspiratory pulse repeating at the configured respiratory rate. It is
 * always present (representing the patient's own drive to breathe),
 * independent of whether CPAP is on — this is what still produces a
 * (very limited) flow signal during a simulated obstructive event with
 * CPAP off, which is the whole point of the OSA case study.
 * @param {number} simTimeSec
 * @param {number} respRateBpm
 * @returns {number} cmH2O
 */
export function patientEffort(simTimeSec, respRateBpm) {
  const freqHz = Math.max(0.05, respRateBpm / 60);
  const phase = (simTimeSec * freqHz) % 1;
  return Math.max(0, Math.sin(phase * Math.PI * 2)) * PHYSIOLOGY.PATIENT_EFFORT_AMPLITUDE;
}

export class RespiratoryModel {
  constructor() {
    this.reset();
  }

  reset() {
    this.pressure = 0; // cmH2O, "Actual Pressure"
    this.flow = 0; // L/s, internal working unit
  }

  /**
   * Advance the model by one fixed timestep.
   * @param {number} dt - seconds
   * @param {object} params
   * @param {number} params.obstruction - 0..100
   * @param {number} params.respRate - breaths per minute
   * @param {number} params.simTime - seconds elapsed in the current run
   * @param {number} params.blowerOutput - 0..100 (from the PID controller, or 0 if CPAP is off)
   * @param {boolean} params.cpapOn
   * @returns {{pressure:number, flow:number, resistance:number, drive:number, effort:number}}
   *   pressure in cmH2O, flow in L/min (converted for display), resistance in cmH2O·s/L
   */
  step(dt, { obstruction, respRate, simTime, blowerOutput, cpapOn }) {
    const resistance = resistanceFromObstruction(obstruction);
    const effort = patientEffort(simTime, respRate);
    const blowerContribution = cpapOn ? (blowerOutput / 100) * PHYSIOLOGY.BLOWER_MAX_PRESSURE : 0;
    const drive = blowerContribution + effort;

    const flow = (drive - this.pressure) / resistance; // L/s
    this.pressure += (flow / PHYSIOLOGY.COMPLIANCE) * dt;

    // Numerical safety net only (not a physiological clamp) — keeps the
    // simulation stable if an extreme gain combination is entered.
    if (!Number.isFinite(this.pressure)) this.pressure = 0;
    this.pressure = Math.max(-30, Math.min(60, this.pressure));

    this.flow = flow;

    return {
      pressure: this.pressure,
      flow: flow * 60, // L/min, more familiar unit for display
      resistance,
      drive,
      effort
    };
  }
}

export default { PHYSIOLOGY, resistanceFromObstruction, patientEffort, RespiratoryModel };
