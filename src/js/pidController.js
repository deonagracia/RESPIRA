/**
 * pidController.js — Phase 2
 * -----------------------------------------------------------------------
 * A textbook discrete PID controller with conditional-integration
 * anti-windup: the integral term is only allowed to accumulate further
 * when doing so would NOT push the output past its saturation limits.
 * This is a standard, simple, and correct way to avoid integral windup
 * without needing back-calculation or a separate tracking gain — a good
 * fit for a teaching tool where Kp/Ki/Kd are exposed directly to the user
 * and can otherwise be pushed into aggressive/unstable territory.
 *
 * output(t) = Kp*e(t) + Ki*∫e dt + Kd*de/dt, clamped to [outMin, outMax]
 */

export class PIDController {
  /**
   * @param {object} [opts]
   * @param {number} [opts.kp=0]
   * @param {number} [opts.ki=0]
   * @param {number} [opts.kd=0]
   * @param {number} [opts.outMin=0]
   * @param {number} [opts.outMax=100]
   */
  constructor({ kp = 0, ki = 0, kd = 0, outMin = 0, outMax = 100 } = {}) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
    this.outMin = outMin;
    this.outMax = outMax;
    this.reset();
  }

  /** Update one or more gains without touching the controller's internal memory. */
  setGains({ kp, ki, kd } = {}) {
    if (kp != null) this.kp = kp;
    if (ki != null) this.ki = ki;
    if (kd != null) this.kd = kd;
  }

  /** Clear integral and derivative memory — call this whenever the loop is (re)started. */
  reset() {
    this.integral = 0;
    this.prevError = null;
  }
/**
   * Advance the controller by one fixed timestep.
   * @param {number} error - target - actual, in the process variable's units
   * @param {number} dt - seconds
   * @returns {number} control output, clamped to [outMin, outMax]
   */
  update(error, dt) {
    // PROTEKSI PHASE 3: Cegah NaN atau Infinity masuk ke dalam kalkulasi PID
    if (!Number.isFinite(error) || !Number.isFinite(dt) || dt <= 0) {
      return this._lastOutput ?? 0;
    }

    const proportional = this.kp * error;
    const derivative = this.prevError === null ? 0 : (error - this.prevError) / dt;
    const derivativeTerm = this.kd * derivative;

    // Tentatively integrate, then only commit it if the resulting output
    // does not saturate — this is the anti-windup guard.
    const tentativeIntegral = this.integral + error * dt;
    const tentativeOutput = proportional + this.ki * tentativeIntegral + derivativeTerm;

    let output = tentativeOutput;
    if (tentativeOutput > this.outMax) {
      output = this.outMax;
    } else if (tentativeOutput < this.outMin) {
      output = this.outMin;
    } else {
      this.integral = tentativeIntegral;
    }

    this.prevError = error;
    this._lastOutput = output;
    return output;
  }
}

export default PIDController;
