/**
 * breathAnalyzer.js — Phase 3
 * -----------------------------------------------------------------------
 * Mengolah sinyal mentah model (aliran, volume, Pmus, SpO2) menjadi
 * parameter yang biasa ditampilkan monitor CPAP / polisomnografi (PSG):
 *
 *  - Tidal volume (VT) per napas     = Vmax − Vmin dalam satu siklus napas
 *  - Respiratory rate terukur (RR)   = jumlah napas efektif per menit
 *  - Deteksi kejadian (kriteria AASM, disederhanakan):
 *      Apnea    : amplitudo napas turun ≥ 90 % dari baseline selama ≥ 10 s
 *      Hipopnea : amplitudo napas turun ≥ 30 % selama ≥ 10 s
 *                 DAN disertai desaturasi SpO2 ≥ 3 %
 *  - AHI (Apnea–Hypopnea Index) = (apnea + hipopnea) / jam tidur
 *      < 5 normal · 5–15 ringan · 15–30 sedang · ≥ 30 berat
 *
 * Amplitudo napas memakai VT per napas (surrogate aliran), dibandingkan
 * dengan baseline = VT maksimum 2 menit terakhir (pre-event baseline).
 */

const APNEA_RATIO = 0.1; // VT ≤ 10 % baseline  → penurunan ≥ 90 %
const HYPOPNEA_RATIO = 0.7; // VT ≤ 70 % baseline → penurunan ≥ 30 %
const MIN_EVENT_SEC = 10;
const DESAT_THRESHOLD = 3; // % SpO2
const DESAT_LOOKAHEAD_SEC = 25; // desaturasi biasanya tertinggal dari kejadian
const BASELINE_WINDOW_SEC = 120;
const BASELINE_DEFAULT_L = 0.55;
const EFFECTIVE_BREATH_L = 0.15; // napas dihitung "efektif" bila VT ≥ 150 mL
const RR_WINDOW_SEC = 30;

export class BreathAnalyzer {
  constructor() {
    this.reset();
  }

  reset() {
    this.prevPmus = 0;
    this.breathStart = null;
    this.vMin = Infinity;
    this.vMax = -Infinity;
    this.history = []; // {t, vt}
    this.lastVT = null;
    this.rr = null;

    this.current = null; // kejadian yang sedang berlangsung {start, apneaSec, spo2Start, spo2Min}
    this.pending = []; // kejadian yang menunggu evaluasi desaturasi
    this.events = []; // {type:'apnea'|'hypopnea', start, end}
    this.apneaCount = 0;
    this.hypopneaCount = 0;
    this.spo2Min = null;
  }

  /**
   * Dipanggil setiap langkah fisika.
   * @param {{t:number, volume:number, pmus:number, spo2:number}} s
   */
  step({ t, volume, pmus, spo2 }) {
    this.vMin = Math.min(this.vMin, volume);
    this.vMax = Math.max(this.vMax, volume);
    this.spo2Min = this.spo2Min == null ? spo2 : Math.min(this.spo2Min, spo2);
    if (this.current) this.current.spo2Min = Math.min(this.current.spo2Min, spo2);
    this.pending.forEach((p) => (p.spo2Min = Math.min(p.spo2Min, spo2)));

    // Awal inspirasi = Pmus mulai negatif (onset usaha napas)
    const onset = this.prevPmus >= 0 && pmus < 0;
    this.prevPmus = pmus;
    if (onset) {
      if (this.breathStart != null) this._closeBreath(t, spo2);
      this.breathStart = t;
      this.vMin = volume;
      this.vMax = volume;
    }

    this._resolvePending(t);
  }

  _closeBreath(t, spo2) {
    const vt = Math.max(0, this.vMax - this.vMin);
    const duration = t - this.breathStart;
    this.lastVT = vt;
    this.history.push({ t, vt });
    while (this.history.length && this.history[0].t < t - BASELINE_WINDOW_SEC) this.history.shift();

    // RR terukur: jumlah napas efektif (VT ≥ 150 mL) per menit dalam 30 s terakhir.
    // Saat apnea, usaha napas tetap ada tetapi tidak menghasilkan volume → RR turun.
    const windowStart = Math.max(0, t - RR_WINDOW_SEC);
    const recent = this.history.filter((h) => h.t >= windowStart);
    const effective = recent.filter((h) => h.vt >= EFFECTIVE_BREATH_L).length;
    const span = recent.length > 1 ? recent[recent.length - 1].t - recent[0].t : 0;
    this.rr = span > 0 ? (Math.max(0, effective - (recent[0].vt >= EFFECTIVE_BREATH_L ? 1 : 0)) * 60) / span : null;

    // Baseline = VT terbesar 2 menit terakhir (minimal nilai referensi)
    const baseline = Math.max(BASELINE_DEFAULT_L * 0.6, ...this.history.map((h) => h.vt));
    const ratio = vt / baseline;

    if (ratio <= HYPOPNEA_RATIO) {
      if (!this.current) {
        this.current = { start: this.breathStart, apneaSec: 0, spo2Start: spo2, spo2Min: spo2 };
      }
      if (ratio <= APNEA_RATIO) this.current.apneaSec += duration;
    } else if (this.current) {
      // Napas kembali normal → kejadian selesai pada awal napas ini
      const ev = { ...this.current, end: this.breathStart };
      this.current = null;
      const length = ev.end - ev.start;
      if (length >= MIN_EVENT_SEC) {
        if (ev.apneaSec >= MIN_EVENT_SEC) {
          this._record('apnea', ev);
        } else {
          this.pending.push({ ...ev, resolveAt: ev.end + DESAT_LOOKAHEAD_SEC });
        }
      }
    }
  }

  _resolvePending(t) {
    this.pending = this.pending.filter((p) => {
      const desat = p.spo2Start - p.spo2Min;
      if (desat >= DESAT_THRESHOLD) {
        this._record('hypopnea', p);
        return false;
      }
      return t < p.resolveAt; // buang bila tidak ada desaturasi cukup
    });
  }

  _record(type, ev) {
    this.events.push({ type, start: ev.start, end: ev.end });
    if (type === 'apnea') this.apneaCount += 1;
    else this.hypopneaCount += 1;
  }

  /** Ringkasan untuk ditampilkan. */
  snapshot(t) {
    const total = this.apneaCount + this.hypopneaCount;
    const hours = t / 3600;
    return {
      vt: this.lastVT,
      rr: this.rr,
      apneaCount: this.apneaCount,
      hypopneaCount: this.hypopneaCount,
      ahi: t >= 60 ? total / hours : null, // AHI baru bermakna setelah ≥ 1 menit
      inEvent: !!this.current,
      events: this.events,
      spo2Min: this.spo2Min
    };
  }
}

/** Klasifikasi keparahan OSA berdasarkan AHI (AASM). */
export function ahiSeverity(ahi) {
  if (ahi == null) return null;
  if (ahi < 5) return 'Normal';
  if (ahi < 15) return 'Ringan';
  if (ahi < 30) return 'Sedang';
  return 'Berat';
}

export default BreathAnalyzer;
