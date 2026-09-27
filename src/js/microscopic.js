/**
 * microscopic.js — "Zoom to Alveoli" view.
 *
 * Reached from the Anatomy page's "Zoom to Alveoli" button and the
 * Simulation page's zoom FAB. Shows the zoom breadcrumb (WHOLE LUNG ->
 * BRONCHUS -> BRONCHIOLE -> ALVEOLAR SAC -> ALVEOLUS -> CAPILLARY), with
 * only "Alveolus" reachable so far, plus a labeled, conceptual
 * cross-section (alveolar air space, wall, capillary, red blood cells,
 * O2/CO2 particles). A short scale-in animation on mount (see
 * .microscopic-page in style.css) gives navigating here the feel of the
 * camera moving deeper rather than a flat page swap.
 *
 * Phase 2: the O2/CO2 particle animation speed and intensity are now
 * driven by the simulation engine's live airflow reading (via
 * alveolus.js#ventilationIntensity — see that file's header for why this
 * stops short of an actual gas-exchange/diffusion model). If no
 * simulation has been started yet, it falls back to the same gentle idle
 * animation Phase 1 used.
 */

import { qs, qsa } from './ui.js';
import { subscribe } from './state.js';
import { ventilationIntensity, particleDurationScale, particleActivity } from './alveolus.js';

const BREADCRUMB = ['Whole Lung', 'Bronchus', 'Bronchiole', 'Alveolar Sac', 'Alveolus', 'Capillary'];

let unsubscribe = null;

export function render() {
  return `
    <section class="microscopic-page">
      <header class="page-heading">
        <p class="page-kicker">SIMULATE · MICROSCOPIC VIEW</p>
        <h1>Alveolus and Gas Exchange</h1>
        <p class="page-lede">
          This is a conceptual, illustrative view of a single alveolus, not a modeled
          gas-diffusion process. The particle motion below is driven by the simulation's
          actual airflow: faster, brighter particles mean more air is currently moving.
        </p>
        <span class="status-chip" id="micro-ventilation-chip">Ventilation: -- (start a simulation)</span>
      </header>

      <nav class="zoom-breadcrumb" aria-label="Zoom level">
        ${BREADCRUMB.map((label, i) => `
          <span class="zoom-crumb ${label === 'Alveolus' ? 'current' : 'disabled'}" title="${label === 'Alveolus' ? 'Current level' : 'Available in a later phase'}">
            ${label}
          </span>
          ${i < BREADCRUMB.length - 1 ? '<span class="zoom-crumb-arrow">→</span>' : ''}
        `).join('')}
      </nav>

      <div class="microscopic-stage">
        <svg class="microscopic-svg" viewBox="0 0 400 260" role="img" aria-label="Alveolus cross-section placeholder">
          <defs>
            <radialGradient id="micro-air-grad" cx="50%" cy="50%" r="65%">
              <stop offset="0%" stop-color="#7DD3D0" stop-opacity="0.18" />
              <stop offset="100%" stop-color="#0F9D9A" stop-opacity="0.05" />
            </radialGradient>
          </defs>

          <ellipse class="micro-air-space" cx="180" cy="130" rx="150" ry="100" fill="url(#micro-air-grad)" />
          <ellipse class="micro-wall" cx="180" cy="130" rx="150" ry="100" fill="none" />

          <path class="micro-capillary" d="M40 130 C 120 60, 240 60, 360 130 C 240 200, 120 200, 40 130" fill="none" />

          <g class="micro-rbc-cells">
            <ellipse class="micro-rbc" cx="90" cy="95" rx="11" ry="6"></ellipse>
            <ellipse class="micro-rbc" cx="170" cy="66" rx="11" ry="6"></ellipse>
            <ellipse class="micro-rbc" cx="250" cy="70" rx="11" ry="6"></ellipse>
            <ellipse class="micro-rbc" cx="150" cy="188" rx="11" ry="6"></ellipse>
            <ellipse class="micro-rbc" cx="250" cy="184" rx="11" ry="6"></ellipse>
          </g>

          <g class="micro-o2-particles">
            <circle class="micro-particle o2" cx="120" cy="90" r="5"></circle>
            <circle class="micro-particle o2" cx="200" cy="70" r="5"></circle>
            <circle class="micro-particle o2" cx="260" cy="110" r="5"></circle>
            <circle class="micro-particle o2" cx="150" cy="160" r="5"></circle>
          </g>
          <g class="micro-co2-particles">
            <circle class="micro-particle co2" cx="90" cy="150" r="5"></circle>
            <circle class="micro-particle co2" cx="220" cy="170" r="5"></circle>
            <circle class="micro-particle co2" cx="290" cy="140" r="5"></circle>
            <circle class="micro-particle co2" cx="180" cy="100" r="5"></circle>
          </g>
        </svg>

        <ul class="microscopic-legend" id="microscopic-legend">
          <li data-target="air-space"><span class="legend-swatch air-space"></span>Alveolar Air Space</li>
          <li data-target="wall"><span class="legend-swatch wall"></span>Alveolar Wall</li>
          <li data-target="capillary"><span class="legend-swatch capillary"></span>Capillary</li>
          <li data-target="rbc"><span class="legend-swatch rbc"></span>Red Blood Cells</li>
          <li data-target="o2"><span class="legend-swatch o2"></span>O₂ Particles</li>
          <li data-target="co2"><span class="legend-swatch co2"></span>CO₂ Particles</li>
        </ul>
      </div>

      <p class="microscopic-note">
        This diagram is conceptual and educational. Particle speed and glow scale with
        simulated airflow (ventilation), but the number of particles shown is not a real
        gas count, and diffusion rate and O₂/CO₂ partial pressure are not modeled.
      </p>

      <div class="microscopic-actions">
        <a class="btn btn-outline" href="#/simulate">← Back to Lung</a>
        <a class="btn btn-ghost" href="#/learn/anatomy">Back to Anatomy</a>
      </div>
    </section>
  `;
}

export function init() {
  const stage = qs('.microscopic-stage');
  qsa('#microscopic-legend li').forEach((li) => {
    li.addEventListener('click', () => {
      const target = li.dataset.target;
      const alreadyActive = li.classList.contains('active');
      qsa('#microscopic-legend li').forEach((el) => el.classList.remove('active'));
      stage.classList.remove('highlight-air-space', 'highlight-wall', 'highlight-capillary', 'highlight-o2', 'highlight-co2');
      if (!alreadyActive) {
        li.classList.add('active');
        stage.classList.add(`highlight-${target}`);
      }
    });
  });

  unsubscribe = subscribe((state) => applyVentilation(state.airflow));
}

function applyVentilation(airflowLmin) {
  const stage = qs('.microscopic-stage');
  const chip = qs('#micro-ventilation-chip');
  if (!stage || !chip) return;

  if (airflowLmin == null) {
    stage.style.removeProperty('--particle-duration');
    stage.style.removeProperty('--particle-activity');
    chip.textContent = 'Ventilation: -- (start a simulation)';
    chip.classList.remove('status-ok', 'status-warning');
    return;
  }

  const intensity = ventilationIntensity(airflowLmin);
  stage.style.setProperty('--particle-duration', `${particleDurationScale(intensity).toFixed(2)}s`);
  stage.style.setProperty('--particle-activity', particleActivity(intensity).toFixed(2));

  chip.textContent = `Ventilation: ${Math.round(intensity * 100)}% (${airflowLmin.toFixed(1)} L/min)`;
  chip.classList.toggle('status-ok', intensity > 0.15);
  chip.classList.toggle('status-warning', intensity <= 0.15);
}

export function dispose() {
  unsubscribe?.();
  unsubscribe = null;
}

export default { render, init, dispose };
