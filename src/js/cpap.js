/**
 * cpap.js — "03 CPAP" page.
 *
 * Visual flow: CPAP MACHINE → AIRFLOW → MASK → UPPER AIRWAY → LUNG.
 * The [Activate CPAP] button toggles shared `state.js` (`cpapOn`) and
 * emits a `cpap:toggle` event on the bus so a future simulation engine
 * can subscribe to the exact same action — the button itself does not
 * run any mathematical model, it only drives the illustrative airway
 * diagram between "narrowed" and "open".
 */

import { createAirwayDiagram } from './airway2D.js';
import { qs, qsa, renderStepFooter } from './ui.js';
import { getState, setState, subscribe } from './state.js';
import { emit } from './bus.js';

let airway = null;
let unsubscribe = null;

const FLOW_NODES = [
  { id: 'machine', label: 'CPAP Machine', icon: '⚙' },
  { id: 'airflow', label: 'Airflow', icon: '〜' },
  { id: 'mask', label: 'Mask', icon: '▭' },
  { id: 'airway', label: 'Upper Airway', icon: '⌇' },
  { id: 'lung', label: 'Lung', icon: '❋' }
];

export function render() {
  return `
    <section class="cpap-page">
      <header class="page-heading">
        <p class="page-kicker">03 · LEARN</p>
        <h1>Continuous Positive Airway Pressure (CPAP)</h1>
        <p class="page-lede">
          CPAP provides continuous positive airway pressure to help maintain airway openness,
          preventing the collapse that causes obstructive apnea events.
        </p>
      </header>

      <div class="cpap-flow" id="cpap-flow">
        ${FLOW_NODES.map((node, i) => `
          ${i > 0 ? `<span class="cpap-arrow" data-arrow="${i}"><svg width="28" height="12" viewBox="0 0 28 12" aria-hidden="true"><path d="M0 6h24M18 1l6 5-6 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : ''}
          <div class="cpap-node" data-node="${node.id}">
            <span class="cpap-node-icon">${node.icon}</span>
            <span class="cpap-node-label">${node.label}</span>
          </div>
        `).join('')}
      </div>

      <div class="cpap-visual-row">
        <div class="cpap-visual-panel">
          <div class="osa-panel-header">
            <h2>Upper Airway Response</h2>
            <span class="status-chip" id="cpap-airway-status">Narrowed</span>
          </div>
          <div class="osa-visual" id="cpap-airway-visual"></div>
        </div>

        <div class="cpap-status-panel">
          <p class="info-eyebrow">CPAP State</p>
          <p class="cpap-status-value" id="cpap-status-value">OFF</p>
          <p class="cpap-status-desc" id="cpap-status-desc">
            Airway pressure is not being applied. The upper airway is shown in its
            unsupported, OSA-narrowed state.
          </p>
          <button type="button" class="btn btn-primary btn-lg" id="btn-activate-cpap">Activate CPAP</button>
          <p class="cpap-note">
            This is a conceptual diagram of the CPAP flow. Open Simulate to see the same
            relationship, driven by the live PID controller and pressure model.
          </p>
        </div>
      </div>

      ${renderStepFooter({ route: '/learn/osa', label: 'OSA' }, { route: '/simulate', label: 'Next: Simulate' })}
    </section>
  `;
}

export function init() {
  airway = createAirwayDiagram(qs('#cpap-airway-visual'), {
    obstruction: 74,
    active: true,
    flowSpeed: 0.5
  });

  const btn = qs('#btn-activate-cpap');
  btn.addEventListener('click', () => {
    const next = !getState().cpapOn;
    setState({ cpapOn: next });
    emit('cpap:toggle', { on: next });
  });

  unsubscribe = subscribe(({ cpapOn }) => applyCpapState(cpapOn));
  // Ensure the flow diagram starts in sync even if state was left "on" from a previous visit.
  applyCpapState(getState().cpapOn);
}

function applyCpapState(cpapOn) {
  const btn = qs('#btn-activate-cpap');
  const flow = qs('#cpap-flow');
  const statusValue = qs('#cpap-status-value');
  const statusDesc = qs('#cpap-status-desc');
  const airwayStatus = qs('#cpap-airway-status');

  if (!btn) return;

  flow.classList.toggle('active', cpapOn);
  btn.textContent = cpapOn ? 'Deactivate CPAP' : 'Activate CPAP';
  btn.classList.toggle('btn-primary', !cpapOn);
  btn.classList.toggle('btn-danger-outline', cpapOn);

  statusValue.textContent = cpapOn ? 'ON' : 'OFF';
  statusValue.classList.toggle('is-on', cpapOn);

  statusDesc.textContent = cpapOn
    ? 'Positive pressure is being applied through the mask, splinting the upper airway open.'
    : 'Airway pressure is not being applied. The upper airway is shown in its unsupported, OSA-narrowed state.';

  airwayStatus.textContent = cpapOn ? 'Open' : 'Narrowed';
  airwayStatus.classList.toggle('status-ok', cpapOn);
  airwayStatus.classList.toggle('status-warning', !cpapOn);

  airway?.setObstruction(cpapOn ? 10 : 74);
  airway?.setFlowSpeed(cpapOn ? 1.1 : 0.5);

  qsa('.cpap-node', flow).forEach((n) => n.classList.toggle('active', cpapOn));
}

export function dispose() {
  unsubscribe?.();
  airway?.dispose();
  airway = null;
  unsubscribe = null;
}

export default { render, init, dispose };
