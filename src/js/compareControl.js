/**
 * compareControl.js — "Compare Control" educational modal.
 *
 * Reachable from the header button on every page. Shows the Natural
 * Respiratory Control feedback loop next to the CPAP (artificial) control
 * feedback loop, purely as a static visual comparison.
 */

import { openModal } from './ui.js';

const NATURAL_STEPS = ['O₂ / CO₂ changes', 'Chemoreceptor', 'Respiratory Center', 'Respiratory Muscles', 'Ventilation'];
const CPAP_STEPS = ['Target Pressure', 'Pressure Sensor', 'PID Controller', 'Blower', 'Airway Pressure'];

function renderChain(steps) {
  return steps.map((step, i) => `
    <div class="chain-node">${step}</div>
    ${i < steps.length - 1 ? '<div class="chain-arrow">↓</div>' : ''}
  `).join('');
}

export function renderCompareControl() {
  return `
    <div class="compare-control">
      <div class="compare-column">
        <h4>Natural Respiratory Control</h4>
        <div class="chain">
          ${renderChain(NATURAL_STEPS)}
          <div class="chain-feedback">
            <span>↺ Feedback</span>
          </div>
        </div>
      </div>

      <div class="compare-column">
        <h4>CPAP Control</h4>
        <div class="chain">
          ${renderChain(CPAP_STEPS)}
          <div class="chain-feedback">
            <span>↺ Feedback</span>
          </div>
        </div>
      </div>
    </div>
    <p class="compare-note">
      Both systems are closed-loop feedback controllers: the body senses a deviation and
      corrects it via ventilation, while CPAP senses a pressure deviation and corrects it
      via the blower. The PID controller continuously calculates and adjusts the blower output in real-time to maintain the target airway pressure.
    </p>
  `;
}

export function initCompareControl() {
  const btn = document.getElementById('compare-control-btn');
  btn?.addEventListener('click', () => {
    openModal(renderCompareControl(), { title: 'Compare Control: Natural vs. Artificial', className: 'modal-compare' });
  });
}

export default { renderCompareControl, initCompareControl };