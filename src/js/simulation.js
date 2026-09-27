/**
 * simulation.js — "04 SIMULATE" page, the centerpiece of the lab.
 */

import { LungScene } from './lung3D.js';
import { createAirwayDiagram } from './airway2D.js';
import { qs, qsa, renderStepFooter, toast } from './ui.js';
import { getState, setState, resetState, subscribe } from './state.js';
import { emit, on } from './bus.js';
import { navigate } from './navigation.js';
import { LineChart } from './charts.js';
import { resetRun } from './simulationEngine.js';
import { getSamples } from './simHistory.js';

const CHART_WINDOW_SEC = 15; // seconds visible on the live rolling charts

let scene = null;
let airwayPreview = null;
let unsubscribeState = null;
let unsubscribeTick = null;
let fullscreenHandler = null;

let pressureChart = null;
let airflowChart = null;
let blowerChart = null;

// Memori untuk menghaluskan dinamika paru-paru & timer
let currentBreathPhase = 0;
let lastTime = 0;
let smoothExpansion = 0;

function severityLabel(pct) {
  if (pct < 15) return 'None';
  if (pct < 40) return 'Mild';
  if (pct < 70) return 'Moderate';
  return 'Severe';
}

export function render() {
  return `
    <section class="lab-page">
      <div class="lab-viewport" id="lab-viewport">
        <div id="lab-lung-mount" class="lung3d-mount"></div>

        <div class="lab-status-chips" id="lab-status-chips">
          <span class="status-chip" id="chip-sim-status">Idle</span>
          <span class="status-chip status-off" id="chip-cpap-status">CPAP Off</span>
          <span class="status-chip" id="chip-obstruction-status">Obstruction: None</span>
        </div>

        <div class="sleep-phase-banner" id="sleep-phase-banner" hidden>
          <span class="sleep-phase-eyebrow">Sleep Simulation, not a display theme: a scripted obstructive-event cycle</span>
          <span class="sleep-phase-label" id="sleep-phase-label">Normal Breathing</span>
        </div>

        <div class="viewport-toolbar lab-viewport-toolbar">
          <button type="button" class="btn btn-icon" id="btn-lab-reset-view" title="Reset camera view">
            ⌂ <span>Reset View</span>
          </button>
          <button type="button" class="btn btn-icon" id="btn-lab-zoom-in" title="Zoom in">
            ＋ <span>Zoom In</span>
          </button>
          <button type="button" class="btn btn-icon" id="btn-lab-zoom-out" title="Zoom out">
            － <span>Zoom Out</span>
          </button>
          <button type="button" class="btn btn-icon" id="btn-lab-fullscreen" title="Fullscreen">
            ⛶ <span>Fullscreen</span>
          </button>
        </div>

        <button type="button" class="btn btn-outline zoom-fab" id="zoom-alveoli-btn">
          🔬 Zoom to Alveoli
        </button>
      </div>

      <button type="button" class="floating-toggle panel-toggle" id="toggle-controls" aria-expanded="true">
        ⚙ Controls
      </button>
      <aside class="floating-panel controls-panel open" id="controls-panel">
        <header class="floating-panel-header">
          <h3>Simulation Controls</h3>
          <button type="button" class="panel-collapse" data-close="controls-panel" aria-label="Collapse panel">&minus;</button>
        </header>

        <div class="control-group">
          <label class="control-label" for="ctl-obstruction">
            Airway Obstruction
            <span class="control-value" id="val-obstruction">20%</span>
          </label>
          <input type="range" id="ctl-obstruction" min="0" max="100" step="1" value="20" />
          <div class="control-mini-row">
            <span class="severity-tag" id="severity-tag">Mild</span>
            <div class="mini-airway" id="mini-airway"></div>
          </div>
          <p class="control-live-note" id="obstruction-auto-note" hidden>Auto-driven by Sleep Simulation</p>
        </div>

        <div class="control-group">
          <label class="control-label" for="ctl-target-pressure">
            Target Pressure
            <span class="control-value" id="val-target-pressure">8 cmH₂O</span>
          </label>
          <input type="range" id="ctl-target-pressure" min="4" max="20" step="0.5" value="8" />
        </div>

        <div class="control-group">
          <label class="control-label" for="ctl-resp-rate">
            Respiratory Rate
            <span class="control-value" id="val-resp-rate">14 br/min</span>
          </label>
          <input type="range" id="ctl-resp-rate" min="8" max="30" step="1" value="14" />
        </div>

        <details class="control-group pid-group" open>
          <summary>PID Gains <span class="pid-badge">Live</span></summary>
          <p class="pid-hint">Adjust these while the simulation runs to change how aggressively CPAP reacts to pressure error.</p>
          <div class="pid-inputs">
            <label>Kp <input type="number" id="ctl-kp" step="0.1" min="0" /></label>
            <label>Ki <input type="number" id="ctl-ki" step="0.1" min="0" /></label>
            <label>Kd <input type="number" id="ctl-kd" step="0.01" min="0" /></label>
          </div>
        </details>

        <div class="control-actions">
          <button type="button" class="btn btn-toggle" id="btn-cpap-toggle" aria-pressed="false">CPAP: Off</button>
        </div>

        <div class="control-actions run-actions">
          <button type="button" class="btn btn-primary" id="btn-start">▶ Start</button>
          <button type="button" class="btn btn-outline" id="btn-pause" disabled>⏸ Pause</button>
          <button type="button" class="btn btn-ghost" id="btn-reset">⟲ Reset</button>
          <button type="button" class="btn btn-outline" id="btn-sleep">🌙 Sleep Simulation</button>
        </div>
      </aside>

      <button type="button" class="floating-toggle status-toggle" id="toggle-status" aria-expanded="true">
        📊 Status
      </button>
      <aside class="floating-panel status-panel open" id="status-panel">
        <header class="floating-panel-header">
          <h3>Live Status</h3>
          <button type="button" class="panel-collapse" data-close="status-panel" aria-label="Collapse panel">&minus;</button>
        </header>
        <div class="stat-grid">
          <div class="stat-tile" id="tile-timer">
            <span class="stat-label">Elapsed Time</span>
            <span class="stat-value" id="stat-timer">00:00</span>
          </div>
          <div class="stat-tile">
            <span class="stat-label">Target Pressure</span>
            <span class="stat-value" id="stat-target-pressure">8.0 <small>cmH₂O</small></span>
          </div>
          <div class="stat-tile stat-placeholder" id="tile-airflow">
            <span class="stat-label">Airflow</span>
            <span class="stat-value" id="stat-airflow">--</span>
            <span class="stat-note" id="note-airflow">Press Start</span>
          </div>
          <div class="stat-tile stat-placeholder" id="tile-resistance">
            <span class="stat-label">Airway Resistance</span>
            <span class="stat-value" id="stat-resistance">--</span>
            <span class="stat-note" id="note-resistance">Press Start</span>
          </div>
          <div class="stat-tile stat-placeholder" id="tile-blower">
            <span class="stat-label">Blower Output</span>
            <span class="stat-value" id="stat-blower">--</span>
            <span class="stat-note" id="note-blower">Press Start</span>
          </div>
          <div class="stat-tile stat-placeholder" id="tile-error">
            <span class="stat-label">Error</span>
            <span class="stat-value" id="stat-error">--</span>
            <span class="stat-note" id="note-error">Press Start</span>
          </div>
        </div>
      </aside>

      <div class="lab-graph-dock" id="graph-dock">
        <header class="floating-panel-header">
          <h3>Real-Time Graphs</h3>
          <button type="button" class="panel-collapse" data-close="graph-dock" aria-label="Collapse graphs">&minus;</button>
        </header>
        <div class="graph-grid">
          <div class="graph-card">
            <p class="graph-title">Pressure Response</p>
            <canvas class="graph-canvas" id="canvas-pressure" width="320" height="120"></canvas>
            <p class="graph-empty" id="empty-pressure">Waiting for simulation engine…</p>
          </div>
          <div class="graph-card">
            <p class="graph-title">Airflow</p>
            <canvas class="graph-canvas" id="canvas-airflow" width="320" height="120"></canvas>
            <p class="graph-empty" id="empty-airflow">Waiting for simulation engine…</p>
          </div>
          <div class="graph-card">
            <p class="graph-title">Blower Output</p>
            <canvas class="graph-canvas" id="canvas-blower" width="320" height="120"></canvas>
            <p class="graph-empty" id="empty-blower">Waiting for simulation engine…</p>
          </div>
        </div>
      </div>

      ${renderStepFooter({ route: '/learn/cpap', label: 'CPAP' }, { route: '/analyze', label: 'Next: Analyze' })}
    </section>
  `;
}

export function init() {
  const mount = qs('#lab-lung-mount');
  scene = new LungScene(mount, {
    interactive: true,
    autoRotate: true,
    breathing: true,
    dark: true,
    compact: true,
    modelVariant: 'simulate'
  });
  scene.mount();
  scene.setRespiratoryRate(getState().respRate);
  scene.setObstruction(getState().obstruction);
  scene.setCPAPActive(getState().cpapOn);
  scene.setBreathingRunning(getState().simStatus === 'running' || getState().simStatus === 'sleep');

  airwayPreview = createAirwayDiagram(qs('#mini-airway'), {
    obstruction: getState().obstruction,
    active: true,
    flowSpeed: 1,
    particleCount: 5
  });

  pressureChart = new LineChart(qs('#canvas-pressure'), {
    windowSec: CHART_WINDOW_SEC,
    unit: '',
    series: [
      { key: 'target', color: '#7DD3D0', dashed: true, label: 'Target', width: 1.6 },
      { key: 'actual', color: '#0F9D9A', label: 'Actual', fill: true }
    ]
  });
  airflowChart = new LineChart(qs('#canvas-airflow'), {
    windowSec: CHART_WINDOW_SEC,
    unit: ' L/min',
    series: [{ key: 'flow', color: '#7DD3D0', fill: true }]
  });
  blowerChart = new LineChart(qs('#canvas-blower'), {
    windowSec: CHART_WINDOW_SEC,
    unit: '%',
    yMin: 0,
    yMax: 100,
    series: [{ key: 'blower', color: '#F4B942', fill: true }]
  });

  seedChartsFromHistory();

  wireCollapsibles();
  wireControls();
  wireRunButtons();
  wireZoom();
  wireViewportToolbar();

  unsubscribeState = subscribe((state) => applyState(state));
  unsubscribeTick = on('sim:tick', (e) => onTick(e.detail));
}

function seedChartsFromHistory() {
  const samples = getSamples();
  if (!samples.length) return;

  const cutoff = samples[samples.length - 1].t - CHART_WINDOW_SEC;
  const windowed = samples.filter((s) => s.t >= cutoff);

  pressureChart?.setData(windowed.map((s) => ({ t: s.t, target: s.target, actual: s.actual })));
  airflowChart?.setData(windowed.map((s) => ({ t: s.t, flow: s.flow })));
  blowerChart?.setData(windowed.map((s) => ({ t: s.t, blower: s.blower })));

  qs('#empty-pressure')?.setAttribute('hidden', '');
  qs('#empty-airflow')?.setAttribute('hidden', '');
  qs('#empty-blower')?.setAttribute('hidden', '');
}

function onTick(sample) {
  pressureChart?.push({ t: sample.t, target: sample.target, actual: sample.actual });
  airflowChart?.push({ t: sample.t, flow: sample.flow });
  blowerChart?.push({ t: sample.t, blower: sample.blower });

  const emptyPressure = qs('#empty-pressure');
  if (emptyPressure) emptyPressure.style.display = 'none';

  const emptyAirflow = qs('#empty-airflow');
  if (emptyAirflow) emptyAirflow.style.display = 'none';

  const emptyBlower = qs('#empty-blower');
  if (emptyBlower) emptyBlower.style.display = 'none';

  // --- LUNG DYNAMICS LOGIC ---
  if (scene) {
    scene._liveMode = true;

    const dt = Math.min(sample.t - lastTime, 0.1); 
    lastTime = sample.t;
    
    const obs = getState().obstruction;
    const cpapOn = getState().cpapOn; // Status CPAP untuk koreksi visual paru-paru
    const rr = getState().respRate;
    const freq = rr / 60; 

    currentBreathPhase += freq * dt;
    if (currentBreathPhase > 1) currentBreathPhase -= 1;

    let targetExpansion = 0;
    // Paru-paru hanya berhenti total jika obstruksi >= 70% DAN CPAP dalam keadaan OFF
    if (obs >= 70 && !cpapOn) {
      targetExpansion = 0.0; 
    }
    else if (obs >= 25 || (obs >= 70 && cpapOn)) {
      if (currentBreathPhase < 0.2) {
        targetExpansion = currentBreathPhase / 0.2; 
      } else {
        targetExpansion = 1.0 - ((currentBreathPhase - 0.2) / 0.8); 
      }
    }
    else {
      if (currentBreathPhase < 0.4) {
        targetExpansion = currentBreathPhase / 0.4;
      } else {
        targetExpansion = 1.0 - ((currentBreathPhase - 0.4) / 0.6);
      }
    }

    let transitionSpeed = 8.0; 
    if (obs >= 70 && !cpapOn) {
       transitionSpeed = 2.0; 
    } else if (obs >= 25 || (obs >= 70 && cpapOn)) {
       transitionSpeed = 4.0; 
    }

    smoothExpansion += (targetExpansion - smoothExpansion) * (dt * transitionSpeed);
    scene.setBreathingPhase(smoothExpansion);
  }

  // --- TIMER LOGIC ---
  const timerEl = qs('#stat-timer');
  if (timerEl && typeof sample.t === 'number') {
    const m = String(Math.floor(sample.t / 60)).padStart(2, '0');
    const s = String(Math.floor(sample.t % 60)).padStart(2, '0');
    timerEl.innerHTML = `${m}:${s}`;
  }
}

function wireCollapsibles() {
  qs('#toggle-controls').addEventListener('click', () => togglePanel('controls-panel', 'toggle-controls'));
  qs('#toggle-status').addEventListener('click', () => togglePanel('status-panel', 'toggle-status'));

  qsa('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panelId = btn.dataset.close;
      const panel = qs(`#${panelId}`);
      panel.classList.remove('open');
      const toggleId = panelId === 'controls-panel' ? 'toggle-controls' : panelId === 'status-panel' ? 'toggle-status' : null;
      if (toggleId) qs(`#${toggleId}`).setAttribute('aria-expanded', 'false');
    });
  });
}

function togglePanel(panelId, toggleId) {
  const panel = qs(`#${panelId}`);
  const isOpen = panel.classList.toggle('open');
  qs(`#${toggleId}`).setAttribute('aria-expanded', String(isOpen));
}

function wireControls() {
  const obstruction = qs('#ctl-obstruction');
  obstruction.value = String(getState().obstruction);
  obstruction.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    setState({ obstruction: val });
    emit('param:change', { param: 'obstruction', value: val });
  });

  const targetPressure = qs('#ctl-target-pressure');
  targetPressure.value = String(getState().targetPressure);
  targetPressure.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    setState({ targetPressure: val });
    emit('param:change', { param: 'targetPressure', value: val });
  });

  const respRate = qs('#ctl-resp-rate');
  respRate.value = String(getState().respRate);
  respRate.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    setState({ respRate: val });
    emit('param:change', { param: 'respRate', value: val });
  });

  const kpInput = qs('#ctl-kp');
  kpInput.value = String(getState().kp);
  kpInput.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    if (!Number.isNaN(val)) setState({ kp: val });
  });

  const kiInput = qs('#ctl-ki');
  kiInput.value = String(getState().ki);
  kiInput.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    if (!Number.isNaN(val)) setState({ ki: val });
  });

  const kdInput = qs('#ctl-kd');
  kdInput.value = String(getState().kd);
  kdInput.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    if (!Number.isNaN(val)) setState({ kd: val });
  });

  qs('#btn-cpap-toggle').addEventListener('click', () => {
    const next = !getState().cpapOn;
    setState({ cpapOn: next });
    emit('cpap:toggle', { on: next });
  });
}

function wireRunButtons() {
  qs('#btn-start').addEventListener('click', () => {
    setState({ simStatus: 'running' });
    emit('sim:start');
  });

  qs('#btn-pause').addEventListener('click', () => {
    setState({ simStatus: 'paused' });
    emit('sim:pause');
  });

  qs('#btn-reset').addEventListener('click', () => {
    resetRun();
    pressureChart?.clear();
    airflowChart?.clear();
    blowerChart?.clear();
    qs('#empty-pressure')?.removeAttribute('hidden');
    qs('#empty-airflow')?.removeAttribute('hidden');
    qs('#empty-blower')?.removeAttribute('hidden');
    resetState();
    scene?.resetBreathing();
    scene?.setAirflow(0);
    scene?.setPressure(null);
    emit('sim:reset');
    
    currentBreathPhase = 0;
    lastTime = 0;
    smoothExpansion = 0;

    toast('Simulation reset. The model, controller, and recorded history have been cleared.', { type: 'info' });
  });

  qs('#btn-sleep').addEventListener('click', () => {
    const isSleeping = getState().simStatus === 'sleep';
    setState({ simStatus: isSleeping ? 'idle' : 'sleep' });
    emit('sim:sleep', { active: !isSleeping });
    if (!isSleeping) {
      toast('Sleep Simulation started. This is not a display theme: it runs a scripted, repeating airway-obstruction cycle so you can watch CPAP and the PID controller respond to a recurring apnea-like event.', { type: 'info' });
    }
  });
}

function wireZoom() {
  qs('#zoom-alveoli-btn').addEventListener('click', () => navigate('/simulate/microscopic'));
}

function wireViewportToolbar() {
  qs('#btn-lab-reset-view').addEventListener('click', () => scene?.resetCamera());
  qs('#btn-lab-zoom-in').addEventListener('click', () => scene?.zoomIn());
  qs('#btn-lab-zoom-out').addEventListener('click', () => scene?.zoomOut());

  const outerViewport = qs('#lab-viewport');
  const fullscreenBtn = qs('#btn-lab-fullscreen');
  fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    outerViewport.requestFullscreen?.().catch(() => {
      toast('Fullscreen is not available in this browser.', { type: 'warning' });
    });
  });
  fullscreenHandler = () => {
    const isFs = document.fullscreenElement === outerViewport;
    outerViewport.classList.toggle('is-fullscreen', isFs);
    fullscreenBtn.setAttribute('aria-pressed', String(isFs));
    fullscreenBtn.querySelector('span').textContent = isFs ? 'Exit Fullscreen' : 'Fullscreen';
    requestAnimationFrame(() => scene?.resize());
  };
  document.addEventListener('fullscreenchange', fullscreenHandler);
}

function applyState(state) {
  const simChip = qs('#chip-sim-status');
  if (simChip) {
    const labels = { idle: 'Idle', running: 'Running', paused: 'Paused', sleep: 'Sleep Mode' };
    simChip.textContent = labels[state.simStatus] || 'Idle';
    simChip.className = `status-chip status-${state.simStatus}`;
  }

  const cpapChip = qs('#chip-cpap-status');
  if (cpapChip) {
    cpapChip.textContent = state.cpapOn ? 'CPAP On' : 'CPAP Off';
    cpapChip.classList.toggle('status-ok', state.cpapOn);
    cpapChip.classList.toggle('status-off', !state.cpapOn);
  }

  const obstructionChip = qs('#chip-obstruction-status');
  if (obstructionChip) {
    obstructionChip.textContent = `Obstruction: ${severityLabel(state.obstruction)}`;
  }

  const isSleeping = state.simStatus === 'sleep';
  const obstructionInput = qs('#ctl-obstruction');
  if (obstructionInput) {
    obstructionInput.value = String(Math.round(state.obstruction));
    obstructionInput.disabled = isSleeping;
  }
  qs('#obstruction-auto-note')?.toggleAttribute('hidden', !isSleeping);

  const valObstruction = qs('#val-obstruction');
  if (valObstruction) valObstruction.textContent = `${Math.round(state.obstruction)}%`;

  const severityTag = qs('#severity-tag');
  if (severityTag) {
    severityTag.textContent = severityLabel(state.obstruction);
    severityTag.dataset.level = severityLabel(state.obstruction).toLowerCase();
  }

  const valTargetPressure = qs('#val-target-pressure');
  if (valTargetPressure) valTargetPressure.textContent = `${state.targetPressure} cmH₂O`;

  syncNumberInput('#ctl-kp', state.kp);
  syncNumberInput('#ctl-ki', state.ki);
  syncNumberInput('#ctl-kd', state.kd);

  const valRespRate = qs('#val-resp-rate');
  if (valRespRate) valRespRate.textContent = `${state.respRate} br/min`;

  const statTargetPressure = qs('#stat-target-pressure');
  if (statTargetPressure) statTargetPressure.innerHTML = `${state.targetPressure.toFixed(1)} <small>cmH₂O</small>`;

  setStatTile('actual-pressure', state.actualPressure, (v) => `${v.toFixed(1)} <small>cmH₂O</small>`);
  setStatTile('airflow', state.airflow, (v) => `${v.toFixed(1)} <small>L/min</small>`);
  setStatTile('resistance', state.resistance, (v) => `${v.toFixed(1)} <small>cmH₂O·s/L</small>`);
  setStatTile('blower', state.blowerOutput, (v) => `${v.toFixed(0)} <small>%</small>`);
  setStatTile('error', state.error, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} <small>cmH₂O</small>`);

  const errorTile = qs('#tile-error');
  if (errorTile && state.error != null) {
    errorTile.classList.toggle('stat-tile-warning', Math.abs(state.error) > Math.max(1, state.targetPressure * 0.15));
  }

  const cpapBtn = qs('#btn-cpap-toggle');
  if (cpapBtn) {
    cpapBtn.textContent = state.cpapOn ? 'CPAP: On' : 'CPAP: Off';
    cpapBtn.setAttribute('aria-pressed', String(state.cpapOn));
    cpapBtn.classList.toggle('active', state.cpapOn);
  }

  const startBtn = qs('#btn-start');
  const pauseBtn = qs('#btn-pause');
  if (startBtn && pauseBtn) {
    const running = state.simStatus === 'running' || state.simStatus === 'sleep';
    startBtn.disabled = running;
    pauseBtn.disabled = !running;
  }

  const sleepBtn = qs('#btn-sleep');
  sleepBtn?.classList.toggle('active', isSleeping);
  if (sleepBtn) sleepBtn.textContent = isSleeping ? '🌙 End Sleep Simulation' : '🌙 Sleep Simulation';

  airwayPreview?.setObstruction(state.obstruction);
  airwayPreview?.setFlowSpeed(state.airflow != null ? 0.3 + Math.min(1, Math.abs(state.airflow) / 30) : 1);

  const isRunning = state.simStatus === 'running' || state.simStatus === 'sleep';
  scene?.setBreathingRunning(isRunning);
  scene?.setRespiratoryRate(state.respRate);
  scene?.setAutoRotate(state.simStatus !== 'sleep');
  scene?.setObstruction(state.obstruction);
  scene?.setCPAPActive(state.cpapOn);
  scene?.setPressure(state.actualPressure);
  scene?.setAirflow(state.airflow);

  const viewport = qs('#lab-viewport');
  viewport?.classList.toggle('is-sleep', isSleeping);
  viewport?.classList.toggle('is-cpap', state.cpapOn);

  const sleepBanner = qs('#sleep-phase-banner');
  const sleepLabel = qs('#sleep-phase-label');
  const sleepEyebrow = qs('.sleep-phase-eyebrow');
  
  if (sleepBanner) {
    sleepBanner.style.display = isRunning ? 'flex' : 'none'; 
  }
  
  if (sleepLabel) {
    sleepLabel.textContent = sleepPhaseLabel(state.obstruction, state.cpapOn);
  }

  if (sleepEyebrow) {
    sleepEyebrow.textContent = state.simStatus === 'sleep'
      ? 'Sleep Simulation, not a display theme: a scripted obstructive-event cycle'
      : 'Manual Control: Real-time Airway Response';
  }
}

function sleepPhaseLabel(obstructionPct, cpapOn) {
  if (obstructionPct >= 70) return cpapOn ? 'Obstructive Event, CPAP Responding' : 'Obstructive Event (Apnea / Hypopnea)';
  if (obstructionPct >= 25) return cpapOn ? 'Airway Narrowing, CPAP Responding' : 'Airway Narrowing';
  return 'Normal Breathing';
}

function syncNumberInput(selector, value) {
  const el = qs(selector);
  if (!el || document.activeElement === el) return;
  if (Number(el.value) !== value) el.value = String(value);
}

function setStatTile(key, value, formatter) {
  const valueEl = qs(`#stat-${key}`);
  const tileEl = qs(`#tile-${key}`);
  const noteEl = qs(`#note-${key}`);
  if (!valueEl) return;

  if (value == null || Number.isNaN(value)) {
    valueEl.textContent = '--';
    tileEl?.classList.add('stat-placeholder');
    if (noteEl) noteEl.hidden = false;
    return;
  }

  valueEl.innerHTML = formatter(value);
  tileEl?.classList.remove('stat-placeholder');
  if (noteEl) noteEl.hidden = true;
}

export function dispose() {
  unsubscribeState?.();
  unsubscribeTick?.();
  if (fullscreenHandler) document.removeEventListener('fullscreenchange', fullscreenHandler);
  scene?.dispose();
  airwayPreview?.dispose();
  pressureChart?.destroy();
  airflowChart?.destroy();
  blowerChart?.destroy();

  scene = null;
  airwayPreview = null;
  unsubscribeState = null;
  unsubscribeTick = null;
  fullscreenHandler = null;
  pressureChart = null;
  airflowChart = null;
  blowerChart = null;
}

export default { render, init, dispose };