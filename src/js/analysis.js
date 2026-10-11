/**
 * analysis.js — "05 ANALYZE" page (Phase 3).
 *
 * Membaca rekaman simulasi dari simHistory.js lalu menyajikan:
 *  1. Perbandingan TANPA CPAP vs DENGAN CPAP (AHI, apnea, hipopnea, SpO2,
 *     obstruksi efektif, arousal, ventilasi)
 *  2. Kinerja kontrol PID saat CPAP aktif (rise time, overshoot,
 *     settling time, steady-state error, output blower)
 *  3. Grafik hasil + cara membacanya
 *  4. Penjelasan setiap indikator jalan napas & OSA
 *  5. Interpretasi otomatis
 *
 * Semua angka dihitung dari sampel yang benar-benar terekam — tidak ada
 * nilai yang dikarang. Halaman ini adalah snapshot saat dibuka.
 */

import { qs, renderStepFooter } from './ui.js';
import { getSamples, hasData } from './simHistory.js';
import { LineChart } from './charts.js';
import { PHYSIOLOGY, pcritFromObstruction, airwayPatency } from './respiratoryModel.js';
import { getBreathSummary } from './simulationEngine.js';
import { ahiSeverity } from './breathAnalyzer.js';

const MIN_AHI_SEC = 60; // AHI baru bermakna setelah ≥ 60 s data

const CHARTS = [
  {
    id: 'pressure',
    title: 'Tekanan mask (target vs aktual)',
    how: 'Garis putus-putus = setpoint, garis penuh = tekanan terukur. Saat CPAP ON, kurva aktual harus naik ke target lalu tetap di sekitarnya. Riak kecil ±1 cmH₂O wajar karena napas pasien menjadi gangguan (disturbance) bagi loop PID.'
  },
  {
    id: 'airflow',
    title: 'Aliran udara (flow–time)',
    how: 'Positif = inspirasi, negatif = ekspirasi. Napas normal ±30 L/min. Saat apnea kurva hampir datar di 0 walaupun pasien tetap berusaha bernapas — tanda khas apnea OBSTRUKTIF.'
  },
  {
    id: 'volume',
    title: 'Volume paru (volume–time)',
    how: 'Napas tenang berosilasi ±0,5 L di atas FRC. Saat apnea amplitudonya hilang. Saat CPAP ON garis dasar naik sedikit karena tekanan positif mengembangkan paru (volume akhir ekspirasi naik).'
  },
  {
    id: 'spo2',
    title: 'Saturasi oksigen (SpO₂)',
    how: 'Normal 95–100 %. Turun beberapa detik SETELAH apnea dimulai (ada keterlambatan), dan pulih setelah napas kembali. Garis merah 90 % = batas desaturasi klinis.'
  },
  {
    id: 'blower',
    title: 'Output blower (sinyal kendali PID)',
    how: 'Ini output kontroler u(t) dalam %. Lonjakan di awal = PID mengejar setpoint. Setelah stabil, output naik-turun kecil mengikuti siklus napas untuk melawan gangguan.'
  },
  {
    id: 'obstruction',
    title: 'Obstruksi: derajat OSA vs efektif',
    how: 'Garis merah = pengaturan derajat OSA (kecenderungan kolaps). Garis kuning putus-putus = obstruksi efektif yang benar-benar terjadi. Tanpa CPAP keduanya tinggi; dengan CPAP garis kuning turun mendekati 0 → CPAP "membidai" jalan napas.'
  }
];

let charts = [];

/* ---------------------------------------------------------------------- */
/* Render                                                                  */
/* ---------------------------------------------------------------------- */

export function render() {
  return `
    <section class="analysis-page">
      <header class="page-heading">
        <p class="page-kicker">05 · ANALYZE</p>
        <h1>Analisis Simulasi</h1>
        <p class="page-lede">
          Ringkasan hasil simulasi OSA + CPAP berbasis PID: apakah kontroler menjaga tekanan
          sesuai target, dan apakah tekanan tersebut benar-benar mengatasi apnea.
        </p>
      </header>

      <div class="analysis-empty-banner" id="analysis-banner">
        <span id="analysis-banner-text">Belum ada simulasi yang terekam.</span>
        <a class="btn btn-primary btn-sm" href="#/simulate">Ke Simulasi</a>
      </div>

      <section class="analysis-section">
        <h2>1. Hasil klinis: tanpa CPAP vs dengan CPAP</h2>
        <p class="analysis-intro">
          Bagian ini menjawab pertanyaan utama: <b>apakah CPAP mengatasi OSA?</b> Setiap kolom
          dihitung hanya dari bagian simulasi saat CPAP mati atau menyala.
        </p>
        <div class="compare-table-wrap" id="compare-wrap">
          <p class="analysis-muted">Jalankan simulasi tanpa CPAP lalu dengan CPAP untuk melihat perbandingan.</p>
        </div>
      </section>

      <section class="analysis-section">
        <h2>2. Kinerja kontrol PID (saat CPAP menyala)</h2>
        <p class="analysis-intro">
          Metrik respons sistem kendali standar, dihitung sejak CPAP dinyalakan. Toleransi
          stabil = ±1 cmH₂O (atau ±10 % target), setara akurasi alat CPAP komersial.
        </p>
        <div class="stat-grid analysis-stat-grid" id="pid-grid">
          <p class="analysis-muted">Nyalakan CPAP saat simulasi berjalan untuk mengukur kinerja PID.</p>
        </div>
      </section>

      <section class="analysis-section">
        <h2>3. Grafik hasil</h2>
        <p class="analysis-intro">
          Area <span class="legend-chip legend-chip-cpap">hijau</span> = CPAP menyala,
          <span class="legend-chip legend-chip-apnea">merah</span> = apnea,
          <span class="legend-chip legend-chip-hypopnea">kuning</span> = hipopnea.
        </p>
        <div class="graph-grid analysis-graph-grid">
          ${CHARTS.map((c) => `
            <div class="graph-card">
              <p class="graph-title">${c.title}</p>
              <canvas class="graph-canvas" id="a-canvas-${c.id}"></canvas>
              <p class="graph-empty" id="a-empty-${c.id}">Belum ada data</p>
              <p class="graph-how"><b>Cara membaca:</b> ${c.how}</p>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="analysis-section">
        <h2>4. Penjelasan indikator jalan napas &amp; OSA</h2>
        ${renderExplanations()}
      </section>

      <section class="analysis-section">
        <h2>5. Interpretasi otomatis</h2>
        <div class="interpretation-card">
          <div id="interpretation-text">
            <p>Interpretasi hasil simulasi akan muncul di sini setelah simulasi dijalankan.</p>
          </div>
        </div>
      </section>

      ${renderStepFooter({ route: '/simulate', label: 'Simulate' }, null)}
    </section>
  `;
}

function renderExplanations() {
  // Tabel contoh dihitung langsung dari model, jadi selalu konsisten dengan simulasi.
  const rows = [20, 50, 70, 80, 90, 100].map((sev) => {
    const pcrit = pcritFromObstruction(sev);
    const off = (1 - airwayPatency(0, pcrit)) * 100;
    const on = (1 - airwayPatency(8, pcrit)) * 100;
    return `<tr><td>${sev}%</td><td>${fmt(pcrit, 1)}</td><td>${fmt(off, 0)}%</td><td>${fmt(on, 0)}%</td></tr>`;
  }).join('');

  return `
    <div class="explain-grid">
      <article class="explain-card">
        <h3>Effective Obstruction (%)</h3>
        <p>Seberapa tertutup faring <b>saat ini</b> (0 % terbuka, 100 % tertutup), setelah efek CPAP diperhitungkan.</p>
        <p><b>Bedanya dengan slider "OSA Severity":</b> slider mengatur <i>sifat pasien</i>, yaitu seberapa mudah
        faring kolaps, yang dinyatakan sebagai <b>Pcrit</b> (tekanan kritis kolaps). Effective Obstruction adalah
        <i>hasil akhirnya</i>.</p>
        <p class="formula">Pcrit = ${PHYSIOLOGY.PCRIT_NORMAL} + ${PHYSIOLOGY.PCRIT_SEVERE - PHYSIOLOGY.PCRIT_NORMAL} × (severity/100) cmH₂O<br>
        Bukaan A = 1 / (1 + e<sup>−(P<sub>faring</sub> − Pcrit)/${PHYSIOLOGY.COLLAPSE_SLOPE}</sup>)<br>
        Effective Obstruction = (1 − A) × 100 %</p>
        <p>Faring tetap terbuka selama <b>tekanan di dalamnya &gt; Pcrit</b>. Tanpa CPAP tekanan faring ≈ 0; dengan
        CPAP 8 cmH₂O tekanan faring ≈ 8 sehingga faring "dibidai" terbuka (<i>pneumatic splint</i>).</p>
        <table class="explain-table">
          <thead><tr><th>Severity</th><th>Pcrit (cmH₂O)</th><th>Tanpa CPAP</th><th>CPAP 8</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="analysis-muted">Nilai di atas untuk saat ekspirasi akhir. Saat inspirasi tekanan faring sedikit negatif
        sehingga obstruksi sedikit lebih besar. Penyempitan ringan (severity rendah) memang tidak membuat faring kolaps.</p>
      </article>

      <article class="explain-card">
        <h3>Airway Resistance (cmH₂O·s/L)</h3>
        <p>Hambatan total saluran napas pasien — seberapa sulit udara mengalir.</p>
        <p class="formula">R<sub>faring</sub> = ${PHYSIOLOGY.R_UA_OPEN} / A²<br>
        R<sub>total</sub> = R<sub>saluran bawah</sub> (${PHYSIOLOGY.R_AW}) + R<sub>faring</sub><br>
        Aliran Q = ΔP / R<sub>total</sub></p>
        <p>Faring terbuka → ±3 (normal). Saat apnea bisa &gt; 100: udara praktis tidak bisa lewat walaupun pasien
        tetap berusaha bernapas. Karena hambatan naik sebanding 1/A², penyempitan sedikit saja sudah sangat
        mengurangi aliran.</p>
      </article>

      <article class="explain-card">
        <h3>Apnea / Hipopnea</h3>
        <p>Kejadian gangguan napas saat tidur, mengikuti kriteria <b>AASM</b> (American Academy of Sleep Medicine)
        yang disederhanakan. Setiap napas, volume tidal (VT) dibandingkan dengan <b>baseline</b> (VT terbesar
        2 menit terakhir).</p>
        <table class="explain-table">
          <thead><tr><th>Jenis</th><th>Syarat</th></tr></thead>
          <tbody>
            <tr><td><b>Apnea</b></td><td>VT turun ≥ 90 % selama ≥ 10 detik</td></tr>
            <tr><td><b>Hipopnea</b></td><td>VT turun ≥ 30 % selama ≥ 10 detik <b>dan</b> SpO₂ turun ≥ 3 % dari nilai sebelum kejadian</td></tr>
          </tbody>
        </table>
        <p>Kejadian baru <b>tercatat setelah selesai</b> (saat napas pulih), karena baru saat itu durasinya diketahui.
        Hipopnea menunggu hingga 25 s untuk memastikan desaturasi, karena SpO₂ turun terlambat. Jika CPAP dinyalakan
        sebelum 10 s, kejadian tidak dihitung — CPAP berhasil mencegahnya.</p>
      </article>

      <article class="explain-card">
        <h3>AHI (Apnea–Hypopnea Index)</h3>
        <p>Ukuran <b>utama</b> derajat OSA di dunia medis.</p>
        <p class="formula">AHI = (jumlah apnea + hipopnea) / lama tidur (jam)</p>
        <table class="explain-table">
          <thead><tr><th>AHI (kejadian/jam)</th><th>Derajat OSA</th></tr></thead>
          <tbody>
            <tr><td>&lt; 5</td><td>Normal</td></tr>
            <tr><td>5 – 15</td><td>Ringan</td></tr>
            <tr><td>15 – 30</td><td>Sedang</td></tr>
            <tr><td>≥ 30</td><td>Berat</td></tr>
          </tbody>
        </table>
        <p>AHI dihitung setelah ≥ 60 s data, karena ekstrapolasi beberapa detik ke "per jam" tidak bermakna.
        Di simulator ini AHI adalah <b>estimasi</b> dari beberapa menit; secara klinis AHI diukur semalaman
        dengan polisomnografi.</p>
      </article>

      <article class="explain-card">
        <h3>Arousal (terbangun sejenak)</h3>
        <p>Mekanisme alami yang <b>mengakhiri apnea</b>. Bila faring tertutup ±25 s (atau SpO₂ turun ≥ 10 %), otak
        terbangun sebentar, otot dilator faring berkontraksi sehingga Pcrit turun ${PHYSIOLOGY.AROUSAL_PCRIT_DROP} cmH₂O,
        jalan napas terbuka, dan pasien mengambil beberapa napas dalam. Setelah tertidur lagi, tonus otot menurun
        bertahap dan faring kolaps lagi.</p>
        <p>Siklus <b>apnea → arousal → tidur → apnea</b> inilah yang membuat kejadian berulang sepanjang malam dan
        membuat tidur pasien OSA terfragmentasi (penyebab kantuk di siang hari).</p>
      </article>

      <article class="explain-card">
        <h3>Rantai sebab-akibat sistem</h3>
        <p class="formula">Setpoint → PID → blower → tekanan mask → tekanan faring &gt; Pcrit → faring terbuka →
        aliran &amp; VT normal → SpO₂ terjaga → tidak ada apnea → AHI turun</p>
        <p>Bagian 2 menilai <b>separuh pertama</b> rantai ini (apakah kontroler bekerja). Bagian 1 menilai
        <b>separuh kedua</b> (apakah tekanan yang dijaga kontroler benar-benar mengobati OSA).</p>
      </article>
    </div>
  `;
}

/* ---------------------------------------------------------------------- */
/* Init                                                                    */
/* ---------------------------------------------------------------------- */

export function init() {
  if (!hasData()) return;

  const samples = getSamples();
  if (samples.length < 2) return;

  const osa = getBreathSummary();
  const events = osa.osaEvents ?? [];
  const duration = samples[samples.length - 1].t - samples[0].t;

  qs('#analysis-banner-text').textContent =
    `Menampilkan rekaman terakhir: ${fmt(duration, 0)} s simulasi (${samples.length} sampel).`;
  qs('#analysis-banner')?.classList.add('analysis-banner-has-data');

  const groups = {
    off: groupStats(samples, events, false),
    on: groupStats(samples, events, true)
  };
  renderComparison(groups);

  const pid = pidStats(samples);
  renderPid(pid);

  buildCharts(samples, events);

  qs('#interpretation-text').innerHTML = buildInterpretation(groups, pid, duration)
    .map((p) => `<p>${p}</p>`)
    .join('');
}

/* ---------------------------------------------------------------------- */
/* Perhitungan                                                             */
/* ---------------------------------------------------------------------- */

function sampleDt(samples, i) {
  if (i + 1 < samples.length) return samples[i + 1].t - samples[i].t;
  return i > 0 ? samples[i].t - samples[i - 1].t : 0;
}

function cpapAt(samples, t) {
  // sampel pertama dengan waktu ≥ t
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return !!samples[lo].cpapOn;
}

/** Statistik klinis untuk bagian simulasi dengan cpapOn === on. */
function groupStats(samples, events, on) {
  let dur = 0;
  let sumEff = 0;
  let sumVe = 0;
  let sumRes = 0;
  let n = 0;
  let spo2Min = null;
  let arousals = 0;
  let prevAroused = false;
  let pcritSleep = null;

  samples.forEach((s, i) => {
    if (!!s.cpapOn !== on) {
      prevAroused = false;
      return;
    }
    const dt = sampleDt(samples, i);
    dur += dt;
    n += 1;
    sumEff += s.effectiveObstruction ?? 0;
    sumVe += s.ve ?? 0;
    sumRes += s.resistance ?? 0;
    if (s.spo2 != null) spo2Min = spo2Min == null ? s.spo2 : Math.min(spo2Min, s.spo2);
    if (s.aroused && !prevAroused) arousals += 1;
    prevAroused = !!s.aroused;
    if (s.pcrit != null) pcritSleep = pcritSleep == null ? s.pcrit : Math.max(pcritSleep, s.pcrit);
  });

  const mine = events.filter((e) => (e.type === 'apnea' || e.type === 'hypopnea') && cpapAt(samples, e.start) === on);
  const apnea = mine.filter((e) => e.type === 'apnea').length;
  const hypopnea = mine.filter((e) => e.type === 'hypopnea').length;
  const ahi = dur >= MIN_AHI_SEC ? ((apnea + hypopnea) / dur) * 3600 : null;

  return {
    duration: dur,
    present: n > 0,
    apnea,
    hypopnea,
    ahi,
    spo2Min,
    effMean: n ? sumEff / n : null,
    veMean: n ? sumVe / n : null,
    resMean: n ? sumRes / n : null,
    arousals,
    pcritSleep
  };
}

/** Metrik respons PID pada segmen CPAP-ON terpanjang. */
function pidStats(samples) {
  const segs = [];
  let start = null;
  samples.forEach((s, i) => {
    if (s.cpapOn && start == null) start = i;
    if ((!s.cpapOn || i === samples.length - 1) && start != null) {
      const end = s.cpapOn ? i : i - 1;
      segs.push([start, end]);
      start = null;
    }
  });
  if (!segs.length) return null;
  const [a, b] = segs.reduce((best, seg) => (seg[1] - seg[0] > best[1] - best[0] ? seg : best));
  const seg = samples.slice(a, b + 1);
  if (seg.length < 5) return null;

  const t0 = seg[0].t;
  const target = seg[seg.length - 1].target;
  const tol = Math.max(1, target * 0.1);
  const segDur = seg[seg.length - 1].t - t0;

  const p0 = seg[0].actual;
  const rise = seg.find((s) => s.actual >= p0 + 0.9 * (target - p0));
  const riseTime = rise ? rise.t - t0 : null;

  const peak = Math.max(...seg.map((s) => s.actual));
  // Overshoot hanya dari respons awal (sebelum settle), bukan riak napas
  const overshoot = Math.max(0, ((peak - target) / target) * 100);

  let lastOut = -1;
  seg.forEach((s, i) => {
    if (Math.abs(s.error) > tol) lastOut = i;
  });
  const settled = lastOut < seg.length - 1;
  const settlingTime = settled ? seg[Math.min(lastOut + 1, seg.length - 1)].t - t0 : null;

  const tailStart = seg[seg.length - 1].t - Math.min(10, segDur / 2);
  const tail = seg.filter((s) => s.t >= tailStart);
  const sse = tail.reduce((acc, s) => acc + Math.abs(s.error), 0) / tail.length;
  const ripple = Math.max(...tail.map((s) => s.actual)) - Math.min(...tail.map((s) => s.actual));
  const meanActual = tail.reduce((acc, s) => acc + s.actual, 0) / tail.length;

  return {
    duration: segDur,
    target,
    tol,
    riseTime,
    overshoot,
    settlingTime,
    sse,
    ripple,
    meanActual,
    peakBlower: Math.max(...seg.map((s) => s.blower)),
    meanBlower: tail.reduce((acc, s) => acc + s.blower, 0) / tail.length,
    peakPressure: peak
  };
}

/* ---------------------------------------------------------------------- */
/* Tampilan                                                                */
/* ---------------------------------------------------------------------- */

function renderComparison({ off, on }) {
  const wrap = qs('#compare-wrap');
  if (!wrap) return;

  const cell = (g, fn) => (g.present ? fn(g) : '<span class="analysis-muted">tidak dijalankan</span>');
  const ahiCell = (g) =>
    g.ahi == null
      ? `<span class="analysis-muted">butuh ≥ ${MIN_AHI_SEC} s (baru ${fmt(g.duration, 0)} s)</span>`
      : `<b>${fmt(g.ahi, 0)}</b> /jam · <span class="sev sev-${sevClass(g.ahi)}">${ahiSeverity(g.ahi)}</span>`;

  const rows = [
    ['Durasi', (g) => `${fmt(g.duration, 0)} s`, 'Lama bagian simulasi pada kondisi ini.'],
    ['AHI (estimasi)', ahiCell, 'Kejadian per jam — ukuran utama derajat OSA.'],
    ['Apnea', (g) => `${g.apnea}`, 'VT turun ≥ 90 % selama ≥ 10 s.'],
    ['Hipopnea', (g) => `${g.hypopnea}`, 'VT turun ≥ 30 % ≥ 10 s + desaturasi ≥ 3 %.'],
    ['Arousal', (g) => `${g.arousals}`, 'Berapa kali pasien terbangun sejenak karena jalan napas tertutup.'],
    ['SpO₂ terendah', (g) => (g.spo2Min == null ? '--' : `<span class="${g.spo2Min < 90 ? 'val-bad' : ''}">${fmt(g.spo2Min, 0)} %</span>`), 'Normal ≥ 95 %; < 90 % = desaturasi bermakna.'],
    ['Obstruksi efektif rata-rata', (g) => `${fmt(g.effMean, 0)} %`, 'Seberapa tertutup faring rata-rata.'],
    ['Resistansi rata-rata', (g) => `${fmt(g.resMean, 1)} cmH₂O·s/L`, 'Normal ±3.'],
    ['Ventilasi semenit rata-rata', (g) => `${fmt(g.veMean, 1)} L/min`, 'Normal 5–8 L/min saat istirahat.']
  ];

  wrap.innerHTML = `
    <table class="compare-table">
      <thead>
        <tr><th>Indikator</th><th>Tanpa CPAP</th><th>Dengan CPAP</th><th>Keterangan</th></tr>
      </thead>
      <tbody>
        ${rows.map(([label, fn, note]) => `
          <tr>
            <td>${label}</td>
            <td>${cell(off, fn)}</td>
            <td>${cell(on, fn)}</td>
            <td class="analysis-muted">${note}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderPid(pid) {
  const grid = qs('#pid-grid');
  if (!grid || !pid) return;

  const tiles = [
    ['Setpoint (target)', `${fmt(pid.target, 1)} <small>cmH₂O</small>`, 'Tekanan yang diminta ke kontroler.'],
    ['Rise time', pid.riseTime == null ? '<small>tidak tercapai</small>' : `${fmt(pid.riseTime, 2)} <small>s</small>`, 'Waktu mencapai 90 % target sejak CPAP dinyalakan.'],
    ['Overshoot', `${fmt(pid.overshoot, 1)} <small>%</small>`, 'Seberapa jauh tekanan melampaui target. Ideal < 10 %.'],
    ['Settling time', pid.settlingTime == null ? '<small>belum stabil</small>' : `${fmt(pid.settlingTime, 1)} <small>s</small>`, `Waktu sampai error tetap dalam ±${fmt(pid.tol, 1)} cmH₂O.`],
    ['Steady-state error', `${fmt(pid.sse, 2)} <small>cmH₂O</small>`, 'Rata-rata |error| 10 s terakhir.'],
    ['Riak tekanan', `${fmt(pid.ripple, 2)} <small>cmH₂O</small>`, 'Variasi tekanan akibat napas pasien (gangguan).'],
    ['Output blower rata-rata', `${fmt(pid.meanBlower, 0)} <small>%</small>`, `Puncak ${fmt(pid.peakBlower, 0)} %. Mendekati 100 % = aktuator jenuh.`]
  ];

  grid.innerHTML = tiles.map(([label, value, desc]) => `
    <div class="stat-tile">
      <span class="stat-label">${label}</span>
      <span class="stat-value">${value}</span>
      <span class="stat-desc">${desc}</span>
    </div>`).join('');
}

function buildCharts(samples, events) {
  // Interval CPAP-ON sebagai pita hijau
  const cpapBands = [];
  let st = null;
  samples.forEach((s, i) => {
    if (s.cpapOn && st == null) st = s.t;
    if ((!s.cpapOn || i === samples.length - 1) && st != null) {
      cpapBands.push({ start: st, end: s.t, type: 'cpap' });
      st = null;
    }
  });
  const bands = cpapBands.concat(events);

  // Downsample untuk grafik statis agar ringan (maks ±1500 titik)
  const step = Math.max(1, Math.floor(samples.length / 1500));
  const data = samples.filter((_, i) => i % step === 0);

  const common = { theme: 'light' };
  const make = (id, opts, map) => {
    const c = new LineChart(qs(`#a-canvas-${id}`), { ...common, ...opts });
    c.setData(data.map(map));
    c.setBands(bands);
    const empty = qs(`#a-empty-${id}`);
    if (empty) empty.style.display = 'none';
    return c;
  };

  charts = [
    make('pressure', {
      unit: ' cmH₂O', yLabel: 'cmH₂O', yMin: -2, yMax: 20,
      series: [
        { key: 'target', color: '#7DD3D0', dashed: true, label: 'Target', width: 1.6 },
        { key: 'actual', color: '#0F9D9A', label: 'Aktual', width: 1.6 }
      ]
    }, (s) => ({ t: s.t, target: s.cpapOn ? s.target : null, actual: s.actual })),
    make('airflow', {
      unit: ' L/min', yLabel: 'L/min', yMin: -80, yMax: 80,
      series: [{ key: 'flow', color: '#2B8C89', width: 1.2 }]
    }, (s) => ({ t: s.t, flow: s.flow })),
    make('volume', {
      unit: ' L', yLabel: 'Volume (L)', decimals: 2, yMin: 0, yMax: 6.5,
      refLines: [
        { y: PHYSIOLOGY.TLC, label: 'TLC' },
        { y: PHYSIOLOGY.FRC, label: 'FRC' },
        { y: PHYSIOLOGY.RV, label: 'RV' }
      ],
      series: [{ key: 'volume', color: '#E8798A', width: 1.4 }]
    }, (s) => ({ t: s.t, volume: s.volume })),
    make('spo2', {
      unit: ' %', yLabel: 'SpO₂ (%)', decimals: 0, yMin: 80, yMax: 100,
      refLines: [{ y: 90, label: '90 %', color: 'rgba(217, 74, 74, 0.8)' }],
      series: [{ key: 'spo2', color: '#3B82C4', width: 1.8 }]
    }, (s) => ({ t: s.t, spo2: s.spo2 })),
    make('blower', {
      unit: ' %', yLabel: 'Output (%)', decimals: 0, yMin: 0, yMax: 100,
      series: [{ key: 'blower', color: '#E0A526', width: 1.4 }]
    }, (s) => ({ t: s.t, blower: s.blower })),
    make('obstruction', {
      unit: ' %', yLabel: 'Obstruksi (%)', decimals: 0, yMin: 0, yMax: 100,
      series: [
        { key: 'severity', color: '#D94A4A', label: 'Severity', width: 1.6 },
        { key: 'effective', color: '#E0A526', label: 'Efektif', dashed: true, width: 1.6 }
      ]
    }, (s) => ({ t: s.t, severity: s.obstruction, effective: s.effectiveObstruction }))
  ];
}

/* ---------------------------------------------------------------------- */
/* Interpretasi                                                            */
/* ---------------------------------------------------------------------- */

function buildInterpretation({ off, on }, pid, duration) {
  const out = [];

  out.push(
    `Simulasi berjalan ${fmt(duration, 0)} s: ${fmt(off.duration, 0)} s tanpa CPAP dan ${fmt(on.duration, 0)} s dengan CPAP.`
  );

  // --- Kondisi tanpa CPAP
  if (off.present) {
    const total = off.apnea + off.hypopnea;
    if (total > 0) {
      out.push(
        `<b>Tanpa CPAP</b>, terdeteksi ${off.apnea} apnea dan ${off.hypopnea} hipopnea` +
        (off.ahi != null ? ` (AHI ${fmt(off.ahi, 0)}/jam, kategori <b>${ahiSeverity(off.ahi).toLowerCase()}</b>)` : '') +
        `, dengan ${off.arousals} kali arousal dan SpO₂ terendah ${fmt(off.spo2Min, 0)} %. ` +
        `Obstruksi efektif rata-rata ${fmt(off.effMean, 0)} % menunjukkan faring berulang kali kolaps karena ` +
        `tekanan di dalamnya (≈ 0 cmH₂O) lebih rendah dari Pcrit pasien (${fmt(off.pcritSleep, 1)} cmH₂O).`
      );
    } else if (off.arousals > 0) {
      out.push(
        `<b>Tanpa CPAP</b>, jalan napas menyempit dan pasien mengalami ${off.arousals} arousal, tetapi penurunan napas ` +
        `belum memenuhi kriteria apnea/hipopnea (desaturasi < 3 %). Kondisi ini mirip <i>respiratory effort-related arousal</i> ` +
        `(mendengkur berat). Naikkan OSA Severity ke ≥ 80 % untuk memunculkan kejadian.`
      );
    } else {
      out.push(
        `<b>Tanpa CPAP</b>, tidak terjadi kolaps faring (obstruksi efektif rata-rata ${fmt(off.effMean, 0)} %). ` +
        `Pcrit pasien (${fmt(off.pcritSleep, 1)} cmH₂O) masih di bawah tekanan faring, sehingga jalan napas tetap terbuka.`
      );
    }
  }

  // --- Kondisi dengan CPAP
  if (on.present) {
    const total = on.apnea + on.hypopnea;
    let text = `<b>Dengan CPAP</b> ${fmt(pid?.target ?? 0, 1)} cmH₂O, terdeteksi ${on.apnea} apnea dan ${on.hypopnea} hipopnea` +
      (on.ahi != null ? ` (AHI ${fmt(on.ahi, 0)}/jam, ${ahiSeverity(on.ahi).toLowerCase()})` : '') +
      `, SpO₂ terendah ${fmt(on.spo2Min, 0)} %, dan obstruksi efektif rata-rata ${fmt(on.effMean, 0)} %.`;
    if (off.present && off.ahi != null && on.ahi != null) {
      text += ` AHI turun dari ${fmt(off.ahi, 0)} menjadi ${fmt(on.ahi, 0)} kejadian/jam.`;
    }
    out.push(text);

    if (total === 0 && on.effMean != null && on.effMean < 30) {
      out.push(
        'Artinya tekanan positif yang dijaga kontroler berhasil <b>membidai faring</b> (pneumatic splint): tekanan faring ' +
        'tetap di atas Pcrit sehingga jalan napas terbuka dan napas kembali normal.'
      );
    } else if (on.pcritSleep != null && pid) {
      const needed = Math.ceil(on.pcritSleep + 4);
      out.push(
        `CPAP belum sepenuhnya efektif. Pcrit pasien ${fmt(on.pcritSleep, 1)} cmH₂O, sehingga tekanan target sebaiknya ` +
        `dinaikkan ke sekitar <b>${needed} cmH₂O</b> (Pcrit + ±4 cmH₂O) — prinsip yang sama dengan titrasi CPAP di klinik.`
      );
    }
  } else {
    out.push('CPAP belum dinyalakan pada rekaman ini, sehingga efek terapi dan kinerja PID belum bisa dinilai.');
  }

  // --- Kinerja PID
  if (pid) {
    const parts = [];
    parts.push(
      `<b>Kinerja PID:</b> tekanan mencapai 90 % target dalam ${pid.riseTime == null ? '— (tidak tercapai)' : `${fmt(pid.riseTime, 2)} s`}, ` +
      `overshoot ${fmt(pid.overshoot, 1)} %, ` +
      (pid.settlingTime == null ? 'dan belum stabil dalam toleransi' : `stabil setelah ${fmt(pid.settlingTime, 1)} s`) +
      `, dengan steady-state error ${fmt(pid.sse, 2)} cmH₂O dan riak ±${fmt(pid.ripple / 2, 2)} cmH₂O akibat napas pasien.`
    );
    const tips = [];
    if (pid.overshoot > 10) tips.push('overshoot > 10 % → kurangi Kp/Ki atau naikkan Kd');
    if (pid.settlingTime == null) tips.push('belum stabil → naikkan Ki atau periksa apakah blower jenuh');
    if (pid.sse > 0.5) tips.push('steady-state error besar → naikkan Ki');
    if (pid.riseTime != null && pid.riseTime > 3) tips.push('respons lambat → naikkan Kp');
    if (pid.peakBlower >= 99) tips.push('blower sempat 100 % (jenuh) — anti-windup mencegah integral menumpuk');
    parts.push(tips.length ? `Saran penalaan: ${tips.join('; ')}.` : 'Respons sudah baik: cepat, overshoot kecil, dan stabil di sekitar target.');
    out.push(parts.join(' '));
  }

  out.push(
    '<i>Catatan: AHI di simulator adalah estimasi dari beberapa menit simulasi. Secara klinis AHI diukur semalaman ' +
    'dengan polisomnografi. Model ini bersifat edukatif, bukan model klinis tervalidasi.</i>'
  );
  return out;
}

/* ---------------------------------------------------------------------- */
/* Util                                                                    */
/* ---------------------------------------------------------------------- */

function fmt(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '--';
  return v.toFixed(digits).replace('.', ',');
}

function sevClass(ahi) {
  if (ahi < 5) return 'normal';
  if (ahi < 15) return 'mild';
  if (ahi < 30) return 'moderate';
  return 'severe';
}

export function dispose() {
  charts.forEach((c) => c.destroy());
  charts = [];
}

export default { render, init, dispose };
