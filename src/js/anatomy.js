/**
 * anatomy.js — "01 ANATOMY" page.
 *
 * The 3D lung is the center of the experience. Numbered markers are
 * projected live from the 3D scene (see lung3D.js#setMarkers) and open a
 * contextual info panel on click rather than a full-screen panel, per the
 * progressive-disclosure design principle.
 */

import { LungScene } from './lung3D.js';
import { qs, qsa, renderStepFooter, toast } from './ui.js';
import { navigate } from './navigation.js';

let scene = null;
let fullscreenHandler = null;

// Marker anchor points now come from LungScene#anatomyAnchors, which is
// built at runtime from the loaded model's own geometry (see lung3D.js).
// The `position` field below is kept only as a last-resort fallback in
// case a scene fails to expose anatomyAnchors for some reason; it is not
// tuned against the current model and should not be relied on.
const MARKERS = [
{
      id: 'trachea',
      number: '',
      label: 'Trachea',
      title: 'Trachea',
      description: 'The trachea is the main airway connecting the larynx to the bronchial branching. Its walls are reinforced with C-shaped cartilage rings, keeping the passage open as air flows in and out.',
      text: 'The trachea is the main airway connecting the larynx to the bronchial branching. Its walls are reinforced with C-shaped cartilage rings, keeping the passage open as air flows in and out.'
    },
    {
      id: 'r-bronchus',
      number: '',
      label: 'Right Main Bronchus',
      title: 'Right Main Bronchus',
      description: 'The right main bronchus carries air from the trachea to the right lung. It is shorter, wider, and more vertical than the left bronchus, making inhaled foreign objects more likely to lodge here.',
      text: 'The right main bronchus carries air from the trachea to the right lung. It is shorter, wider, and more vertical than the left bronchus, making inhaled foreign objects more likely to lodge here.'
    },
    {
      id: 'l-bronchus',
      number: '',
      label: 'Left Main Bronchus',
      title: 'Left Main Bronchus',
      description: 'The left main bronchus carries air to the left lung. It is longer and narrower because it must curve under the aortic arch before reaching the lung.',
      text: 'The left main bronchus carries air to the left lung. It is longer and narrower because it must curve under the aortic arch before reaching the lung.'
    },
    {
      id: 'r-lung',
      number: '',
      label: 'Right Lung',
      title: 'Right Lung',
      description: 'The right lung is slightly larger than the left lung because it does not share chest space with the heart. In this 3D model, this part is displayed according to its original anatomical mesh.',
      text: 'The right lung is slightly larger than the left lung because it does not share chest space with the heart. In this 3D model, this part is displayed according to its original anatomical mesh.'
    },
    {
      id: 'l-lung',
      number: '',
      label: 'Left Lung',
      title: 'Left Lung',
      description: 'The left lung is slightly smaller to make room for the heart. The 3D model used only includes one lung mesh, so this marker focuses on the mirrored position of the right lung as an anatomical reference.',
      text: 'The left lung is slightly smaller to make room for the heart. The 3D model used only includes one lung mesh, so this marker focuses on the mirrored position of the right lung as an anatomical reference.'
    },
    {
      id: 'bronchioles',
      number: '',
      label: 'Bronchioles',
      title: 'Bronchioles',
      description: 'Bronchioles are increasingly smaller airway branches that no longer have cartilage. They channel air deep into the lung tissue until it reaches the alveolar sacs.',
      text: 'Bronchioles are increasingly smaller airway branches that no longer have cartilage. They channel air deep into the lung tissue until it reaches the alveolar sacs.'
    },
    {
      id: 'alveoli',
      number: '',
      label: 'Alveolus',
      title: 'Alveolus',
      description: 'Alveoli are tiny air sacs where oxygen and carbon dioxide exchange between air and blood. Their microscopic size means their actual structure is only visible via the "Zoom to Alveoli" button below.',
      text: 'Alveoli are tiny air sacs where oxygen and carbon dioxide exchange between air and blood. Their microscopic size means their actual structure is only visible via the "Zoom to Alveoli" button below.'
    },
    {
      id: 'diaphragm',
      number: '',
      label: 'Diaphragm',
      title: 'Diaphragm',
      description: 'The diaphragm is the primary muscle of respiration. It contracts and moves down during inspiration, then rises back up during expiration. The 3D model used does not include a separate diaphragm mesh, so this marker is placed at the lung base as a positional reference.',
      text: 'The diaphragm is the primary muscle of respiration. It contracts and moves down during inspiration, then rises back up during expiration. The 3D model used does not include a separate diaphragm mesh, so this marker is placed at the lung base as a positional reference.'
    }
  ];

export function render() {
  return `
    <section class="anatomy-page">
      <header class="page-heading">
        <p class="page-kicker">01 · LEARN</p>
        <h1>Respiratory Anatomy</h1>
        <p class="page-lede">Click a numbered marker to learn what each structure does, or drag the model to look around.</p>
      </header>

      <div class="anatomy-layout">
        <div class="anatomy-viewport" id="anatomy-viewport">
          <div id="anatomy-lung-mount" class="lung3d-mount"></div>

          <div class="viewport-toolbar">
            <button type="button" class="btn btn-icon" id="btn-rotate" aria-pressed="true" title="Toggle auto-rotate">
              ⟳ <span>Rotate</span>
            </button>
            <button type="button" class="btn btn-icon" id="btn-reset-view" title="Reset camera view">
              ⌂ <span>Reset View</span>
            </button>
            <button type="button" class="btn btn-icon" id="btn-zoom-in" title="Zoom in">
              ＋ <span>Zoom In</span>
            </button>
            <button type="button" class="btn btn-icon" id="btn-zoom-out" title="Zoom out">
              － <span>Zoom Out</span>
            </button>
            <button type="button" class="btn btn-icon" id="btn-fullscreen" title="Fullscreen">
              ⛶ <span>Fullscreen</span>
            </button>
            <button type="button" class="btn btn-icon" id="btn-zoom-alveoli" title="Zoom into a single alveolus">
              🔬 <span>Zoom to Alveoli</span>
            </button>
          </div>

          <p class="viewport-hint">Drag to rotate · right-drag to pan · scroll or pinch to zoom</p>
        </div>

        <aside class="anatomy-info-panel" id="anatomy-info-panel" aria-live="polite">
          <div class="anatomy-info-empty">
            <p>Select a marker on the model to see details here.</p>
          </div>
        </aside>
      </div>

      <ul class="marker-legend" id="marker-legend">
        ${MARKERS.map((m) => `<li data-marker-id="${m.id}"><span class="legend-dot">${m.number}</span>${m.title}</li>`).join('')}
      </ul>

      ${renderStepFooter(null, { route: '/learn/osa', label: 'Next: OSA' })}
    </section>
  `;
}

export function init() {
  const mount = qs('#anatomy-lung-mount');
  const outerViewport = qs('#anatomy-viewport');
  const infoPanel = qs('#anatomy-info-panel');

  scene = new LungScene(mount, {
    interactive: true,
    autoRotate: true,
    breathing: true,
    dark: true
  });
  scene.mount();
  scene.setMarkers(MARKERS, showMarkerInfo);

  qs('#btn-rotate').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const next = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(next));
    btn.classList.toggle('active', next);
    scene.setAutoRotate(next);
  });
  qs('#btn-rotate').classList.add('active');

  qs('#btn-reset-view').addEventListener('click', () => {
    scene.resetCamera();
    scene.clearActiveMarker();
    clearInfoPanel();
  });

  qs('#btn-zoom-in').addEventListener('click', () => scene.zoomIn());
  qs('#btn-zoom-out').addEventListener('click', () => scene.zoomOut());

  const fullscreenBtn = qs('#btn-fullscreen');
  fullscreenBtn.addEventListener('click', () => toggleFullscreen(outerViewport));
  fullscreenHandler = () => {
    const isFs = document.fullscreenElement === outerViewport;
    outerViewport.classList.toggle('is-fullscreen', isFs);
    fullscreenBtn.setAttribute('aria-pressed', String(isFs));
    fullscreenBtn.querySelector('span').textContent = isFs ? 'Exit Fullscreen' : 'Fullscreen';
    // The container size changes when entering/leaving fullscreen; give the
    // browser a frame to settle before telling the 3D scene to resize.
    requestAnimationFrame(() => scene?.resize());
  };
  document.addEventListener('fullscreenchange', fullscreenHandler);

  qs('#btn-zoom-alveoli').addEventListener('click', () => {
    toast('Zooming into a single alveolus, an illustrative conceptual view rather than a real particle simulation.', { type: 'info' });
    navigate('/simulate/microscopic');
  });

  qsa('#marker-legend li').forEach((li) => {
    li.addEventListener('click', () => {
      const marker = MARKERS.find((m) => m.id === li.dataset.markerId);
      if (marker) {
        scene.setActiveMarker(marker.id);
        showMarkerInfo(marker);
      }
    });
  });

  function showMarkerInfo(marker) {
    infoPanel.innerHTML = `
      <div class="anatomy-info-content">
        <p class="info-eyebrow">Anatomy Marker</p>
        <h3>${marker.title}</h3>
        <p>${marker.text}</p>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-close-info">Close</button>
      </div>
    `;
    infoPanel.classList.add('open');
    qs('#btn-close-info', infoPanel)?.addEventListener('click', () => {
      scene.clearActiveMarker();
      clearInfoPanel();
    });
    qsa('#marker-legend li').forEach((li) => li.classList.toggle('active', li.dataset.markerId === marker.id));
  }

  function clearInfoPanel() {
    infoPanel.classList.remove('open');
    infoPanel.innerHTML = `<div class="anatomy-info-empty"><p>Select a marker on the model to see details here.</p></div>`;
    qsa('#marker-legend li').forEach((li) => li.classList.remove('active'));
  }
}

function toggleFullscreen(el) {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
    return;
  }
  el.requestFullscreen?.().catch(() => {
    toast('Fullscreen is not available in this browser.', { type: 'warning' });
  });
}

export function dispose() {
  document.removeEventListener('fullscreenchange', fullscreenHandler);
  scene?.dispose();
  scene = null;
}

export default { render, init, dispose };
