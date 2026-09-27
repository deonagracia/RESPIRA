/**
 * airway2D.js
 * -----------------------------------------------------------------------
 * A reusable, lightweight SVG airway/airflow diagram.
 *
 * Phase 1 scope:
 * The tube's "waist" width is driven directly by an `obstruction` number
 * (0-100) and the particle animation speed by a `flowSpeed` number — both
 * set directly by whichever page uses it (OSA page: static comparison;
 * CPAP page: toggled by the Activate button; Simulation page: live-linked
 * to the Airway Obstruction slider). This is a direct, decorative mapping
 * — there is no fluid-dynamics or respiratory model behind it. It exists
 * so the UI already *looks* alive and is ready for the Phase 2 simulation
 * engine to drive the same two numbers instead of the UI itself.
 */

let instanceCounter = 0;

/**
 * @param {HTMLElement} container
 * @param {object} [options]
 * @param {boolean} [options.narrowed=false] - shorthand for a high starting obstruction
 * @param {number} [options.obstruction] - 0..100, overrides `narrowed` if provided
 * @param {boolean} [options.active=true] - whether particles are flowing
 * @param {number} [options.flowSpeed=1] - relative particle speed multiplier
 * @param {number} [options.particleCount=9]
 * @returns {{setObstruction:(pct:number)=>void, setNarrowed:(b:boolean)=>void, setActive:(b:boolean)=>void, setFlowSpeed:(n:number)=>void, dispose:()=>void}}
 */
export function createAirwayDiagram(container, options = {}) {
  const uid = `airway-${++instanceCounter}`;
  const state = {
    obstruction: options.obstruction ?? (options.narrowed ? 72 : 10),
    active: options.active !== false,
    flowSpeed: options.flowSpeed ?? 1,
    particleCount: options.particleCount ?? 9
  };

  container.classList.add('airway2d');
  container.innerHTML = buildMarkup(uid, state);

  const lumen = container.querySelector('.airway-lumen');
  const wallTop = container.querySelector('.airway-wall-top');
  const wallBottom = container.querySelector('.airway-wall-bottom');

  function applyTube() {
    const d = buildTubePath(state.obstruction);
    lumen.setAttribute('d', d);
    const walls = buildWallPaths(state.obstruction);
    wallTop.setAttribute('d', walls.top);
    wallBottom.setAttribute('d', walls.bottom);
    container.style.setProperty('--obstruction', String(state.obstruction));
    container.classList.toggle('severe', state.obstruction >= 60);
  }

  function applySpeed() {
    const dur = Math.max(0.6, 2.6 / state.flowSpeed).toFixed(2);
    container.querySelectorAll('animateMotion').forEach((node) => {
      node.setAttribute('dur', `${dur}s`);
    });
  }

  function applyActive() {
    container.classList.toggle('inactive', !state.active);
  }

  applyTube();
  applySpeed();
  applyActive();

  return {
    setObstruction(pct) {
      state.obstruction = Math.max(0, Math.min(100, pct));
      applyTube();
    },
    setNarrowed(isNarrowed) {
      state.obstruction = isNarrowed ? 72 : 10;
      applyTube();
    },
    setActive(isActive) {
      state.active = !!isActive;
      applyActive();
    },
    setFlowSpeed(n) {
      state.flowSpeed = Math.max(0.15, n);
      applySpeed();
    },
    dispose() {
      container.innerHTML = '';
    }
  };
}

function buildTubePath(obstructionPct) {
  const openHalf = 30;
  const minGap = 3;
  const midHalf = openHalf - (openHalf - minGap) * (obstructionPct / 100);
  const cy = 50;
  const topOpen = cy - openHalf;
  const botOpen = cy + openHalf;
  const topMid = cy - midHalf;
  const botMid = cy + midHalf;

  return `M0 ${topOpen} C 70 ${topOpen}, 95 ${topMid}, 150 ${topMid} C 205 ${topMid}, 230 ${topOpen}, 300 ${topOpen} ` +
    `L300 ${botOpen} C 230 ${botOpen}, 205 ${botMid}, 150 ${botMid} C 95 ${botMid}, 70 ${botOpen}, 0 ${botOpen} Z`;
}

function buildWallPaths(obstructionPct) {
  const openHalf = 30;
  const minGap = 3;
  const midHalf = openHalf - (openHalf - minGap) * (obstructionPct / 100);
  const cy = 50;
  const topOpen = cy - openHalf;
  const topMid = cy - midHalf;
  const botOpen = cy + openHalf;
  const botMid = cy + midHalf;

  const top = `M0 ${topOpen} C 70 ${topOpen}, 95 ${topMid}, 150 ${topMid} C 205 ${topMid}, 230 ${topOpen}, 300 ${topOpen}`;
  const bottom = `M0 ${botOpen} C 70 ${botOpen}, 95 ${botMid}, 150 ${botMid} C 205 ${botMid}, 230 ${botOpen}, 300 ${botOpen}`;
  return { top, bottom };
}

function buildMarkup(uid, state) {
  const particles = Array.from({ length: state.particleCount }, (_, i) => {
    const yOffset = 44 + ((i % 3) * 6);
    const begin = (i * (2.4 / state.particleCount)).toFixed(2);
    return `
      <circle class="airway-particle" r="2.6" fill="url(#${uid}-particle-grad)">
        <animateMotion dur="2s" begin="${begin}s" repeatCount="indefinite"
          path="M-6 ${yOffset} L306 ${yOffset}" />
      </circle>
    `;
  }).join('');

  return `
    <svg class="airway-svg" viewBox="0 0 300 100" preserveAspectRatio="none" role="img" aria-label="Airway airflow diagram">
      <defs>
        <linearGradient id="${uid}-lumen-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#7DD3D0" stop-opacity="0.28" />
          <stop offset="50%" stop-color="#0F9D9A" stop-opacity="0.4" />
          <stop offset="100%" stop-color="#7DD3D0" stop-opacity="0.28" />
        </linearGradient>
        <radialGradient id="${uid}-particle-grad">
          <stop offset="0%" stop-color="#F7F9F7" />
          <stop offset="100%" stop-color="#7DD3D0" />
        </radialGradient>
      </defs>

      <path class="airway-lumen" fill="url(#${uid}-lumen-grad)" d="" />
      <path class="airway-wall-top" fill="none" d="" />
      <path class="airway-wall-bottom" fill="none" d="" />

      <g class="airway-particles">${particles}</g>
    </svg>
  `;
}

export default { createAirwayDiagram };
