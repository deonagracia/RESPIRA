/**
 * home.js — Landing page.
 *
 * Shows the RESPIRA name/tagline, the two primary entry actions, the same
 * anatomical 3D lung used on the Anatomy page (auto-rotating, built by
 * lung3D.js), and a process strip covering Anatomy, OSA, CPAP, and
 * Simulation that doubles as quick navigation.
 */

import { LungScene } from './lung3D.js';
import { qs } from './ui.js';

let scene = null;

export function render() {
  return `
    <section class="home-hero">
      <div class="home-copy">
        <p class="eyebrow">Respiratory Model &amp; Control Laboratory</p>
        <h1 class="home-title">RESPIRA</h1>
        <p class="home-subtitle">Interactive Respiratory Model &amp; Control Laboratory</p>
        <p class="home-description">
          An interactive environment for exploring respiratory physiology,
          airway obstruction, CPAP intervention, and feedback control.
        </p>
        <div class="home-actions">
          <a class="btn btn-primary btn-lg" href="#/learn/anatomy">Explore Respiratory System</a>
          <a class="btn btn-outline btn-lg" href="#/simulate">Start Simulation</a>
        </div>
      </div>

      <div class="home-visual">
        <div class="home-visual-glow"></div>
        <div id="home-lung-visual" class="lung3d-mount" aria-hidden="true"></div>
        <p class="home-visual-caption">Interactive 3D respiratory model. Open Anatomy to explore it up close.</p>
      </div>
    </section>

    <section class="process-strip" aria-label="How this lab is organized">
      <a class="process-step" href="#/learn/anatomy">
        <span class="process-index">01</span>
        <span class="process-name">Anatomy</span>
        <span class="process-desc">Explore the 3D respiratory system</span>
      </a>
      <span class="process-arrow" aria-hidden="true">→</span>
      <a class="process-step" href="#/learn/osa">
        <span class="process-index">02</span>
        <span class="process-name">OSA</span>
        <span class="process-desc">See how obstructive sleep apnea narrows the airway</span>
      </a>
      <span class="process-arrow" aria-hidden="true">→</span>
      <a class="process-step" href="#/learn/cpap">
        <span class="process-index">03</span>
        <span class="process-name">CPAP</span>
        <span class="process-desc">Understand how CPAP supports the airway</span>
      </a>
      <span class="process-arrow" aria-hidden="true">→</span>
      <a class="process-step" href="#/simulate">
        <span class="process-index">04</span>
        <span class="process-name">Simulate</span>
        <span class="process-desc">Run the model with live PID control</span>
      </a>
      <span class="process-arrow" aria-hidden="true">→</span>
      <a class="process-step" href="#/analyze">
        <span class="process-index">05</span>
        <span class="process-name">Analyze</span>
        <span class="process-desc">Review the system's response</span>
      </a>
    </section>
  `;
}

export function init() {
  const mount = qs('#home-lung-visual');
  if (!mount) return;

  scene = new LungScene(mount, {
    interactive: false,
    autoRotate: true,
    breathing: true,
    dark: true,
    compact: true,
    modelVariant: 'simulate'
  });
  scene.mount();
}

export function dispose() {
  scene?.dispose();
  scene = null;
}

export default { render, init, dispose };
