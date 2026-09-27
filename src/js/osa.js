/**
 * osa.js — "02 OSA" page.
 *
 * Side-by-side NORMAL vs OSA airway comparison using the reusable
 * airway2D SVG diagram. The animation speed/narrowing shown here are
 * fixed illustrative values for Phase 1 — in Phase 2 the same component
 * will be driven by the simulation engine.
 */

import { createAirwayDiagram } from './airway2D.js';
import { qs, renderStepFooter } from './ui.js';
import { navigate } from './navigation.js';

let normalDiagram = null;
let osaDiagram = null;

export function render() {
  return `
    <section class="osa-page">
      <header class="page-heading">
        <p class="page-kicker">02 · LEARN</p>
        <h1>Obstructive Sleep Apnea (OSA)</h1>
        <p class="page-lede">
          OSA occurs when the upper airway repeatedly narrows or collapses during sleep,
          reducing or blocking airflow despite continued effort to breathe.
        </p>
      </header>

      <div class="osa-compare-grid">
        <div class="osa-panel">
          <div class="osa-panel-header">
            <h2>Normal Airway</h2>
            <span class="status-chip status-ok">Open</span>
          </div>
          <div class="osa-visual" id="osa-visual-normal"></div>
          <ul class="osa-facts">
            <li><span class="fact-dot ok"></span>Airway open</li>
            <li><span class="fact-dot ok"></span>Airflow normal</li>
          </ul>
        </div>

        <div class="osa-panel osa-panel-warning">
          <div class="osa-panel-header">
            <h2>Obstructed Airway (OSA)</h2>
            <span class="status-chip status-warning">Narrowed</span>
          </div>
          <div class="osa-visual" id="osa-visual-obstructed"></div>
          <ul class="osa-facts">
            <li><span class="fact-dot warn"></span>Airway narrowed</li>
            <li><span class="fact-dot warn"></span>Airflow reduced</li>
          </ul>
        </div>
      </div>

      <div class="osa-actions">
        <button type="button" class="btn btn-outline" id="btn-explore-osa" aria-expanded="false">Explore OSA</button>
        <button type="button" class="btn btn-primary" id="btn-try-simulation">Try Simulation</button>
      </div>

      <div class="osa-detail" id="osa-detail" hidden>
        <h3>What causes the obstruction?</h3>
        <p>
          During sleep, the muscles supporting the soft palate, tongue, and throat relax.
          In OSA, this relaxation combines with existing anatomical narrowing, letting soft
          tissue collapse inward and partially or fully block airflow, often for ten seconds
          or longer per episode.
        </p>
        <h3>Common signs</h3>
        <ul>
          <li>Loud, irregular snoring with pauses in breathing</li>
          <li>Gasping or choking sounds during sleep</li>
          <li>Excessive daytime sleepiness</li>
          <li>Morning headaches and reduced concentration</li>
        </ul>
        <p class="osa-detail-note">
          In the Simulation lab, the "Airway Obstruction" control lets you reproduce this
          narrowing directly and observe how the system responds.
        </p>
      </div>

      ${renderStepFooter({ route: '/learn/anatomy', label: 'Anatomy' }, { route: '/learn/cpap', label: 'Next: CPAP' })}
    </section>
  `;
}

export function init() {
  normalDiagram = createAirwayDiagram(qs('#osa-visual-normal'), {
    obstruction: 8,
    active: true,
    flowSpeed: 1
  });

  osaDiagram = createAirwayDiagram(qs('#osa-visual-obstructed'), {
    obstruction: 74,
    active: true,
    flowSpeed: 0.45
  });

  const exploreBtn = qs('#btn-explore-osa');
  const detail = qs('#osa-detail');
  exploreBtn.addEventListener('click', () => {
    const isOpen = detail.hasAttribute('hidden');
    detail.toggleAttribute('hidden', !isOpen);
    exploreBtn.setAttribute('aria-expanded', String(isOpen));
    exploreBtn.textContent = isOpen ? 'Hide Details' : 'Explore OSA';
  });

  qs('#btn-try-simulation').addEventListener('click', () => navigate('/simulate'));
}

export function dispose() {
  normalDiagram?.dispose();
  osaDiagram?.dispose();
  normalDiagram = null;
  osaDiagram = null;
}

export default { render, init, dispose };
