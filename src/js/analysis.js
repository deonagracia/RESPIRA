/**
 * analysis.js — "05 ANALYZE" page.
 *
 * Phase 2: reads the recorded run from simHistory.js (written by
 * simulationEngine.js while the Simulate page was active) and renders
 * real System Response metrics, four static result charts, and a short
 * auto-generated interpretation — all computed from the actual recorded
 * samples, nothing fabricated. If no simulation has been run yet, the
 * page falls back to the exact same "no data" layout Phase 1 shipped.
 *
 * This is a snapshot: it reads the history once when the page mounts,
 * matching Phase 1's framing of Analyze as the "look back at what
 * happened" step in the EXPLORE → UNDERSTAND → SIMULATE → ANALYZE flow.
 * If the engine is still running in the background, revisiting this page
 * (or navigating away and back) refreshes the snapshot.
 */

import { qs, renderStepFooter } from './ui.js';
import { getSamples, hasData, computeStats } from './simHistory.js';
import { LineChart } from './charts.js';
import { PHYSIOLOGY } from './respiratoryModel.js';

const STATS = [
  { key: 'target', label: 'Target Pressure', unit: 'cmH₂O' },
  { key: 'actual', label: 'Actual Pressure', unit: 'cmH₂O' },
  { key: 'maxError', label: 'Maximum Error', unit: 'cmH₂O' },
  { key: 'settlingTime', label: 'Settling Time', unit: 's' },
  { key: 'peakBlower', label: 'Peak Blower Output', unit: '%' },
  { key: 'avgFlow', label: 'Average Airflow', unit: 'L/min' }
];

const CHARTS = [
  { id: 'pressure', title: 'Pressure Response' },
  { id: 'volume', title: 'Lung Volume (Volume–Time)' },
  { id: 'airflow', title: 'Airflow' },
  { id: 'spo2', title: 'SpO₂' },
  { id: 'blower', title: 'Blower Output' },
  { id: 'obstruction', title: 'Obstruction Timeline' }
];

let charts = [];

export function render() {
  return `
    <section class="analysis-page">
      <header class="page-heading">
        <p class="page-kicker">05 · ANALYZE</p>
        <h1>Simulation Analysis</h1>
        <p class="page-lede">
          Run a simulation to populate this page with system-response metrics,
          time-series graphs, and an automatic interpretation of the control performance.
        </p>
      </header>

      <div class="analysis-empty-banner" id="analysis-banner">
        <span id="analysis-banner-text">No simulation run recorded yet.</span>
        <a class="btn btn-primary btn-sm" href="#/simulate">Go to Simulation</a>
      </div>

      <section class="analysis-section">
        <h2>System Response</h2>
        <div class="stat-grid analysis-stat-grid">
          ${STATS.map((s) => `
            <div class="stat-tile stat-placeholder" id="a-tile-${s.key}">
              <span class="stat-label">${s.label}</span>
              <span class="stat-value" id="a-stat-${s.key}">-- <small>${s.unit}</small></span>
              <span class="stat-note" id="a-note-${s.key}">No data</span>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="analysis-section">
        <h2>Response Graphs</h2>
        <div class="graph-grid analysis-graph-grid">
          ${CHARTS.map((c) => `
            <div class="graph-card">
              <p class="graph-title">${c.title}</p>
              <canvas class="graph-canvas" id="a-canvas-${c.id}" width="320" height="140"></canvas>
              <p class="graph-empty" id="a-empty-${c.id}">No data yet</p>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="analysis-section">
        <h2>Simulation Interpretation</h2>
        <div class="interpretation-card">
          <p id="interpretation-text">
            Automatic interpretation of your simulation run will appear here, summarizing
            stability, response time, and control performance once a run has completed.
          </p>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-export-report" disabled title="Available in a later phase">
            Export Report
          </button>
        </div>
      </section>

      ${renderStepFooter({ route: '/simulate', label: 'Simulate' }, null)}
    </section>
  `;
}

export function init() {
  qs('#btn-export-report');

  if (!hasData()) {
    return; // Phase 1 "no data" layout stays exactly as rendered above.
  }

  const samples = getSamples();
  const stats = computeStats();
  if (!stats) return;

  qs('#analysis-banner-text').textContent = `Showing the last recorded run: ${stats.sampleCount} samples over ${stats.durationSec.toFixed(1)} s.`;
  qs('#analysis-banner')?.classList.add('analysis-banner-has-data');

  setStat('target', stats.finalTarget, (v) => `${v.toFixed(1)} <small>cmH₂O</small>`);
  setStat('actual', stats.finalActual, (v) => `${v.toFixed(1)} <small>cmH₂O</small>`);
  setStat('maxError', stats.maxError, (v) => `${v.toFixed(2)} <small>cmH₂O</small>`);
  setStat(
    'settlingTime',
    stats.settlingTime,
    (v) => `${v.toFixed(1)} <small>s</small>`,
    stats.settlingTime == null ? 'Not settled' : null
  );
  setStat('peakBlower', stats.peakBlower, (v) => `${v.toFixed(0)} <small>%</small>`);
  setStat('avgFlow', stats.avgFlow, (v) => `${v.toFixed(1)} <small>L/min</small>`);

  buildCharts(samples);
  qs('#interpretation-text').textContent = buildInterpretation(stats);
}

function setStat(key, value, formatter, overrideText) {
  const valueEl = qs(`#a-stat-${key}`);
  const tileEl = qs(`#a-tile-${key}`);
  const noteEl = qs(`#a-note-${key}`);
  if (!valueEl) return;

  if (value == null || Number.isNaN(value)) {
    valueEl.innerHTML = overrideText ?? '--';
    if (noteEl) noteEl.hidden = !overrideText;
    if (noteEl && overrideText) noteEl.textContent = '';
    return;
  }

  valueEl.innerHTML = formatter(value);
  tileEl?.classList.remove('stat-placeholder');
  if (noteEl) noteEl.hidden = true;
}

function buildCharts(samples) {
  const pressure = new LineChart(qs('#a-canvas-pressure'), {
    theme: 'light',
    unit: ' cmH₂O',
    yLabel: 'cmH₂O',
    series: [
      { key: 'target', color: '#7DD3D0', dashed: true, label: 'Target', width: 1.6 },
      { key: 'actual', color: '#0F9D9A', label: 'Actual', fill: true }
    ]
  });
  pressure.setData(samples.map((s) => ({ t: s.t, target: s.target, actual: s.actual })));

  const volume = new LineChart(qs('#a-canvas-volume'), {
    theme: 'light',
    unit: ' L',
    yLabel: 'Volume (L)',
    decimals: 2,
    yMin: 0,
    yMax: 6.5,
    refLines: [
      { y: PHYSIOLOGY.TLC, label: 'TLC' },
      { y: PHYSIOLOGY.FRC, label: 'FRC' },
      { y: PHYSIOLOGY.RV, label: 'RV' }
    ],
    series: [{ key: 'volume', color: '#E8798A', width: 1.6 }]
  });
  volume.setData(samples.map((s) => ({ t: s.t, volume: s.volume })));

  const spo2 = new LineChart(qs('#a-canvas-spo2'), {
    theme: 'light',
    unit: ' %',
    yLabel: 'SpO₂ (%)',
    yMin: 70,
    yMax: 100,
    refLines: [{ y: 90, label: 'Desaturasi < 90%', color: 'rgba(217, 74, 74, 0.8)' }],
    series: [{ key: 'spo2', color: '#5BA4E6' }]
  });
  spo2.setData(samples.map((s) => ({ t: s.t, spo2: s.spo2 })));

  const airflow = new LineChart(qs('#a-canvas-airflow'), {
    theme: 'light',
    unit: ' L/min',
    yLabel: 'L/min',
    series: [{ key: 'flow', color: '#7DD3D0', fill: true }]
  });
  airflow.setData(samples.map((s) => ({ t: s.t, flow: s.flow })));

  const blower = new LineChart(qs('#a-canvas-blower'), {
    theme: 'light',
    unit: '%',
    yLabel: 'Output (%)',
    yMin: 0,
    yMax: 100,
    series: [{ key: 'blower', color: '#F4B942', fill: true }]
  });
  blower.setData(samples.map((s) => ({ t: s.t, blower: s.blower })));

  const obstruction = new LineChart(qs('#a-canvas-obstruction'), {
    theme: 'light',
    unit: '%',
    yLabel: 'Obstruksi (%)',
    yMin: 0,
    yMax: 100,
    series: [
      { key: 'obstruction', color: '#D94A4A', label: 'Severity', fill: true },
      { key: 'effective', color: '#F4B942', label: 'Efektif', dashed: true }
    ]
  });
  obstruction.setData(samples.map((s) => ({ t: s.t, obstruction: s.obstruction, effective: s.effectiveObstruction })));

  charts = [pressure, volume, airflow, spo2, blower, obstruction];

  // --- BAGIAN YANG DIUBAH: Gunakan style.display = 'none' ---
  ['pressure', 'volume', 'airflow', 'spo2', 'blower', 'obstruction'].forEach((id) => {
    const emptyEl = qs(`#a-empty-${id}`);
    if (emptyEl) {
       emptyEl.style.display = 'none';
    }
  });
  // -----------------------------------------------------------
}

// Standard English decimal formatting (dot separator)
function enNum(value, digits = 1) {
  return value.toFixed(digits);
}

/**
 * Builds a short, factual interpretation of the recorded run in English.
 */
function buildInterpretation(stats) {
  const sentences = [];

  const finalError = stats.finalTarget - stats.finalActual;
  const absFinalError = Math.abs(finalError);

  sentences.push(
    `The actual pressure at the end of the simulation was ${enNum(stats.finalActual)} cmH₂O against a target of ${enNum(stats.finalTarget)} cmH₂O.`
  );

  if (absFinalError <= Math.max(0.3, stats.finalTarget * 0.05)) {
    sentences.push(
      `A final error of ${enNum(absFinalError, 2)} cmH₂O indicates that the pressure reached the target reasonably well.`
    );
  } else {
    sentences.push(
      `A final error of ${enNum(absFinalError, 2)} cmH₂O indicates that the pressure did not fully reach the target. Adjusting the Ki value may help reduce this steady-state error.`
    );
  }

  if (stats.settlingTime != null) {
    sentences.push(
      `The system reached stability (settling time) after approximately ${enNum(stats.settlingTime)} seconds, and the pressure remained within the tolerance band until the end of the simulation.`
    );
  } else {
    sentences.push(
      'The pressure did not reach stability within the tolerance band during the recorded simulation. This condition may be caused by a high level of obstruction relative to the current Kp, Ki, and Kd values.'
    );
  }

  const startupDominated = stats.maxError > stats.lateMaxError * 1.8 && stats.maxError > 2;
  if (startupDominated) {
    sentences.push(
      `The maximum error during the simulation (${enNum(stats.maxError)} cmH₂O) occurred during the initial phase when the pressure rose from zero to the target, which is a normal transient condition at startup.`
    );
  }

  const lateThreshold = Math.max(1, stats.finalTarget * 0.15);
  if (stats.lateMaxError > lateThreshold) {
    sentences.push(
      `During the later part of the simulation, the error still reached ${enNum(stats.lateMaxError)} cmH₂O. Adjusting Kp or Ki may help tighten the pressure tracking against the target.`
    );
  } else {
    sentences.push(
      `During the later part of the simulation, the error remained within ${enNum(stats.lateMaxError)} cmH₂O, which is a relatively small deviation from the target.`
    );
  }

  if (stats.peakBlower >= 99) {
    sentences.push(
      'The blower output reached 100% during the simulation. This indicates that the actuator is working at maximum capacity to overcome the given obstruction.'
    );
  }

  return sentences.join(' ');
}

export function dispose() {
  charts.forEach((c) => c.destroy());
  charts = [];
}

export default { render, init, dispose };
