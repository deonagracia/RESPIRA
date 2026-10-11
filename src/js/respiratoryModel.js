/**
 * respiratoryModel.js — Phase 3 (physiological rewrite)
 * -----------------------------------------------------------------------
 * Plant model untuk OSA + CPAP, berbasis persamaan gerak sistem respirasi
 * (equation of motion) + upper airway sebagai Starling resistor.
 *
 *   Pao + Pmus = R_total·Q + E·ΔV            (equation of motion)
 *   Palv       = E·ΔV − Pmus... ditulis ulang  →  Palv = ΔV/C + Pmus
 *   Q          = (Pmask − Palv) / (R_aw + R_ua + R_circuit)
 *   dV/dt      = Q
 *
 * Upper airway (faring) = Starling resistor:
 *   luas lumen A = sigmoid((P_faring − Pcrit) / k)
 *   R_ua         = R_UA_OPEN / A²
 *   Pcrit naik seiring derajat OSA (slider "obstruction"):
 *     0 %  → Pcrit = −8 cmH2O (normal, jalan napas tetap terbuka)
 *     100% → Pcrit = +5 cmH2O (OSA berat, kolaps saat tidur)
 *
 * Siklus apnea–arousal: bila faring tertutup ±25 s (atau SpO2 turun ≥10 %),
 * otak terbangun sebentar (arousal) → otot dilator faring aktif → jalan napas
 * terbuka → napas pemulihan dalam → pasien tertidur lagi, tonus otot turun
 * bertahap, dan faring kolaps lagi. Siklus inilah yang menghasilkan kejadian
 * apnea/hipopnea berulang pada pasien OSA.
 *   → CPAP menaikkan tekanan faring di atas Pcrit sehingga jalan napas
 *     "dibidai" (pneumatic splint) dan aliran kembali normal. Inilah
 *     mekanisme terapi CPAP yang sebenarnya.
 *
 * Mask/blower: tekanan mask = tekanan blower − R_circuit·Q, sehingga
 * napas pasien menjadi gangguan (disturbance) yang harus dilawan PID.
 *
 * Volume paru dilaporkan absolut (L) agar grafik volume–waktu bisa
 * dibandingkan dengan spirogram standar (RV, ERV, FRC, VT, IRV, TLC).
 *
 * Model edukatif — parameter dipilih agar nilai berada di rentang
 * fisiologis orang dewasa, bukan model klinis tervalidasi.
 */

export const PHYSIOLOGY = Object.freeze({
  // Volume paru (L) — sesuai spirogram standar dewasa
  RV: 1.2,
  FRC: 2.3, // volume relaksasi (end-expiratory) tanpa CPAP
  TLC: 6.0,

  // Mekanika
  COMPLIANCE: 0.1, // L/cmH2O, compliance sistem respirasi total
  R_AW: 2.0, // cmH2O·s/L, resistansi saluran napas bawah
  R_UA_OPEN: 1.0, // cmH2O·s/L, resistansi faring saat terbuka penuh
  R_CIRCUIT: 2.0, // cmH2O·s/L, selang + mask (hanya saat CPAP terpasang)

  // Starling resistor
  PCRIT_NORMAL: -8,
  PCRIT_SEVERE: 5,
  COLLAPSE_SLOPE: 1.8, // cmH2O, kecuraman transisi buka/tutup
  A_MIN: 0.03, // luas lumen minimum (oklusi hampir total)

  // Usaha napas (otot inspirasi)
  PMUS_MAX: 6.0, // cmH2O, amplitudo puncak tekanan otot (dikalibrasi → VT ≈ 0,55 L)
  TI_FRACTION: 0.4, // Ti / Ttot (I:E ≈ 1:1.5)
  POST_INSP_FRACTION: 0.6, // bagian ekspirasi tempat diafragma masih melepas tegangan bertahap

  // Arousal (terbangun singkat) — mekanisme alami yang mengakhiri apnea
  AROUSAL_OBSTRUCTED_SEC: 25, // s jalan napas tertutup sebelum otak terbangun
  AROUSAL_DESAT: 10, // % penurunan SpO2 yang juga memicu arousal (bila tertutup ≥ 10 s)
  AROUSAL_DURATION: 9, // s otot faring aktif setelah terbangun
  AROUSAL_PCRIT_DROP: 14, // cmH2O, Pcrit turun karena otot dilator faring berkontraksi
  AROUSAL_EFFORT_GAIN: 1.5, // napas pemulihan lebih dalam (hiperventilasi pasca-apnea)
  SLEEP_REONSET_TAU: 10, // s, tonus otot faring menurun bertahap saat pasien tertidur lagi
  CLOSED_PATENCY: 0.5, // faring dianggap "tertutup" bila bukaan < 50 %

  // Blower
  BLOWER_MAX_PRESSURE: 25, // cmH2O pada output 100 %
  BLOWER_TAU: 0.08, // s, konstanta waktu motor blower

  // Saturasi oksigen (model orde-1 sederhana)
  SPO2_BASE: 97,
  SPO2_MIN: 78, // target saturasi saat ventilasi nol (desaturasi tipikal OSA 4–15 %)
  SPO2_TAU_DESAT: 14, // s
  SPO2_TAU_RESAT: 6, // s
  VE_NORMAL: 6 // L/min, ventilasi semenit normal
});

/** Pcrit (cmH2O) sebagai fungsi derajat obstruksi 0..100 %. */
export function pcritFromObstruction(obstructionPct) {
  const f = Math.min(100, Math.max(0, obstructionPct)) / 100;
  return PHYSIOLOGY.PCRIT_NORMAL + (PHYSIOLOGY.PCRIT_SEVERE - PHYSIOLOGY.PCRIT_NORMAL) * f;
}

/** Fraksi luas lumen faring (0..1) dari tekanan faring dan Pcrit. */
export function airwayPatency(pPharynx, pcrit) {
  const a = 1 / (1 + Math.exp(-(pPharynx - pcrit) / PHYSIOLOGY.COLLAPSE_SLOPE));
  return Math.max(PHYSIOLOGY.A_MIN, a);
}

/**
 * Tekanan otot napas Pmus(t) (negatif = menarik udara masuk).
 *
 * Model Younes yang disederhanakan:
 *  - Inspirasi (0 … Ti): kontraksi diafragma naik halus (bentuk 1 − cos)
 *    sampai puncak −Pmax di akhir inspirasi.
 *  - Awal ekspirasi: diafragma TIDAK langsung lemas, tetapi melepas
 *    tegangannya bertahap (post-inspiratory activity) selama ±60 % Te.
 *    Inilah yang membuat ekspirasi pelan dan kurva volume berbentuk
 *    gelombang halus seperti pada spirogram napas tenang.
 *  - Sisa ekspirasi: otot diam (0), paru kembali ke FRC oleh recoil elastik.
 */
export function patientEffort(simTimeSec, respRateBpm) {
  const P = PHYSIOLOGY;
  const T = 60 / Math.max(3, respRateBpm);
  const Ti = T * P.TI_FRACTION;
  const Te = T - Ti;
  const t = simTimeSec % T;
  if (t < Ti) return -P.PMUS_MAX * (1 - Math.cos((Math.PI * t) / Ti)) / 2;
  const x = (t - Ti) / (Te * P.POST_INSP_FRACTION);
  if (x >= 1) return 0;
  return -P.PMUS_MAX * (1 + Math.cos(Math.PI * x)) / 2;
}

export class RespiratoryModel {
  constructor() {
    this.reset();
  }

  reset() {
    this.dV = 0; // L, volume di atas volume relaksasi (FRC)
    this.blowerPressure = 0; // cmH2O, tekanan keluaran blower (setelah lag motor)
    this.pressure = 0; // cmH2O, tekanan mask (variabel terkontrol)
    this.flow = 0; // L/s, + = inspirasi
    this.patency = 1;
    this.spo2 = PHYSIOLOGY.SPO2_BASE;
    this.ve = PHYSIOLOGY.VE_NORMAL; // L/min, ventilasi semenit (rata-rata bergerak)
    this.closedSec = 0; // s, lama faring tertutup tanpa jeda
    this.arousalSec = 0; // s, sisa waktu fase arousal (0 = tidur)
    this.dilatorTone = 0; // 0..1, aktivitas otot dilator faring (1 = terjaga penuh)
    this.spo2AtClosure = this.spo2;
  }

  /**
   * @param {number} dt detik
   * @param {{obstruction:number, respRate:number, simTime:number, blowerOutput:number, cpapOn:boolean}} p
   */
  step(dt, { obstruction, respRate, simTime, blowerOutput, cpapOn }) {
    const P = PHYSIOLOGY;

    // 1. Blower (orde-1)
    const blowerCmd = cpapOn ? (blowerOutput / 100) * P.BLOWER_MAX_PRESSURE : 0;
    this.blowerPressure += ((blowerCmd - this.blowerPressure) / P.BLOWER_TAU) * dt;
    const rCircuit = cpapOn ? P.R_CIRCUIT : 0;
    const pSource = cpapOn ? this.blowerPressure : 0;

    // 2. Usaha napas & tekanan alveolar
    const aroused = this.arousalSec > 0;
    const pmus = patientEffort(simTime, respRate) * (aroused ? P.AROUSAL_EFFORT_GAIN : 1);
    const palv = this.dV / P.COMPLIANCE + pmus;

    // 3. Starling resistor — tekanan faring dari langkah sebelumnya
    // Saat arousal, otot dilator faring (genioglossus) aktif → faring lebih kaku → Pcrit turun.
    // Setelah pasien tertidur lagi, tonus otot menurun bertahap (bukan seketika).
    if (aroused) this.dilatorTone = 1;
    else this.dilatorTone *= Math.exp(-dt / P.SLEEP_REONSET_TAU);
    const pcritSleep = pcritFromObstruction(obstruction);
    const pcrit = pcritSleep - P.AROUSAL_PCRIT_DROP * this.dilatorTone;
    const pPharynx = this.pressure - this.flow * P.R_UA_OPEN * 0.5;
    this.patency = airwayPatency(pPharynx, pcrit);
    const rUa = P.R_UA_OPEN / (this.patency * this.patency);

    // Siklus apnea–arousal: faring tertutup cukup lama / SpO2 turun → otak terbangun
    // sebentar, jalan napas terbuka, lalu pasien tertidur lagi dan faring bisa kolaps kembali.
    if (aroused) {
      this.arousalSec = Math.max(0, this.arousalSec - dt);
      this.closedSec = 0;
    } else if (this.patency < P.CLOSED_PATENCY) {
      if (this.closedSec === 0) this.spo2AtClosure = this.spo2;
      this.closedSec += dt;
      const desat = this.spo2AtClosure - this.spo2;
      if (this.closedSec >= P.AROUSAL_OBSTRUCTED_SEC || (this.closedSec >= 10 && desat >= P.AROUSAL_DESAT)) {
        this.arousalSec = P.AROUSAL_DURATION;
        this.closedSec = 0;
      }
    } else {
      this.closedSec = 0;
    }
    const rTotal = P.R_AW + rUa + rCircuit;

    // 4. Aliran & volume
    const flow = (pSource - palv) / rTotal;
    this.flow = flow;
    this.pressure = pSource - rCircuit * flow; // tekanan mask
    this.dV += flow * dt;

    // Batas fisiologis volume (RV..TLC)
    const vAbs = P.FRC + this.dV;
    if (vAbs < P.RV) this.dV = P.RV - P.FRC;
    if (vAbs > P.TLC) this.dV = P.TLC - P.FRC;

    // 5. Ventilasi semenit & SpO2
    const inspFlowLmin = Math.max(0, flow) * 60;
    const veTau = 5; // s, rata-rata bergerak ~1 siklus napas
    this.ve += ((inspFlowLmin - this.ve) / veTau) * dt; // rata-rata waktu aliran inspirasi = VT × RR
    const ratio = Math.min(1, this.ve / P.VE_NORMAL);
    const spo2Target = P.SPO2_MIN + (P.SPO2_BASE - P.SPO2_MIN) * Math.pow(ratio, 0.6);
    const tau = spo2Target < this.spo2 ? P.SPO2_TAU_DESAT : P.SPO2_TAU_RESAT;
    this.spo2 += ((spo2Target - this.spo2) / tau) * dt;

    if (!Number.isFinite(this.pressure)) this.pressure = 0;
    if (!Number.isFinite(this.dV)) this.dV = 0;

    return {
      pressure: this.pressure, // cmH2O (mask)
      flow: flow * 60, // L/min
      volume: P.FRC + this.dV, // L, absolut
      tidalDelta: this.dV, // L, di atas FRC relaksasi
      resistance: rTotal - rCircuit, // cmH2O·s/L (pasien)
      patency: this.patency, // 0..1
      effectiveObstruction: (1 - this.patency) * 100, // %
      pcrit,
      pcritSleep,
      aroused,
      pmus,
      palv,
      spo2: this.spo2,
      ve: this.ve
    };
  }
}

export default { PHYSIOLOGY, pcritFromObstruction, airwayPatency, patientEffort, RespiratoryModel };
