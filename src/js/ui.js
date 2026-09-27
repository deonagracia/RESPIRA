/**
 * ui.js
 * -----------------------------------------------------------------------
 * Shared, framework-free UI helpers used across every page module:
 *  - journey step bar (01 ANATOMY → 02 OSA → 03 CPAP → 04 SIMULATE → 05 ANALYZE)
 *  - active nav-link highlighting
 *  - modal (used by Compare Control, and available to any future feature)
 *  - toast notifications (used for Phase-1 placeholder actions)
 *  - a small "prev / next" step footer used on the Learn/Simulate/Analyze pages
 */

export const JOURNEY_STEPS = [
  { step: 1, label: 'ANATOMY', route: '/learn/anatomy' },
  { step: 2, label: 'OSA', route: '/learn/osa' },
  { step: 3, label: 'CPAP', route: '/learn/cpap' },
  { step: 4, label: 'SIMULATE', route: '/simulate' },
  { step: 5, label: 'ANALYZE', route: '/analyze' }
];

/** Shorthand querySelector. */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/** Shorthand querySelectorAll returning a real array. */
export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * Render (or hide) the journey step bar for the current route.
 * @param {number|null} activeStep - 1..5, or null to hide the bar entirely
 */
export function renderJourney(activeStep) {
  const bar = qs('#journey-bar');
  if (!bar) return;

  if (!activeStep) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }

  bar.hidden = false;
  bar.innerHTML = JOURNEY_STEPS.map(({ step, label, route }, i) => {
    let state = 'upcoming';
    if (step < activeStep) state = 'completed';
    if (step === activeStep) state = 'active';

    const connector = i > 0
      ? `<span class="journey-connector ${step <= activeStep ? 'filled' : ''}"></span>`
      : '';

    return `
      ${connector}
      <a class="journey-step ${state}" href="#${route}" data-step="${step}">
        <span class="journey-dot">${state === 'completed' ? '✓' : String(step).padStart(2, '0')}</span>
        <span class="journey-label">${label}</span>
      </a>
    `;
  }).join('');
}

/** Highlight the matching top-level nav link / dropdown for the given path. */
export function setActiveNav(path) {
  const links = qsa('#main-nav [data-route]');
  links.forEach((a) => a.classList.remove('active'));

  const learnTrigger = qs('[data-route-group="learn"]');
  learnTrigger?.classList.remove('active');

  if (path === '/home') {
    qs('[data-route="home"]')?.classList.add('active');
  } else if (path.startsWith('/learn')) {
    learnTrigger?.classList.add('active');
  } else if (path.startsWith('/simulate')) {
    qs('[data-route="simulate"]')?.classList.add('active');
  } else if (path.startsWith('/analyze')) {
    qs('[data-route="analyze"]')?.classList.add('active');
  }
}

/* ---------------------------------------------------------------------- */
/* Modal                                                                   */
/* ---------------------------------------------------------------------- */

let lastFocused = null;

/**
 * Open a modal dialog with the given inner HTML.
 * @param {string} bodyHtml
 * @param {{title?: string, className?: string}} [opts]
 */
export function openModal(bodyHtml, opts = {}) {
  const root = qs('#modal-root');
  if (!root) return;

  lastFocused = document.activeElement;

  root.innerHTML = `
    <div class="modal-overlay" id="active-modal-overlay">
      <div class="modal-card ${opts.className || ''}" role="dialog" aria-modal="true" aria-label="${opts.title || ''}">
        <header class="modal-header">
          <h3>${opts.title || ''}</h3>
          <button type="button" class="modal-close" aria-label="Close">&times;</button>
        </header>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>
  `;

  const overlay = qs('#active-modal-overlay', root);
  const closeBtn = qs('.modal-close', root);

  const close = () => closeModal();
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onModalKeydown);

  requestAnimationFrame(() => overlay.classList.add('open'));
  closeBtn.focus();
}

function onModalKeydown(e) {
  if (e.key === 'Escape') closeModal();
}

export function closeModal() {
  const root = qs('#modal-root');
  const overlay = qs('#active-modal-overlay', root);
  document.removeEventListener('keydown', onModalKeydown);
  if (!overlay) return;
  overlay.classList.remove('open');
  setTimeout(() => {
    root.innerHTML = '';
  }, 180);
  if (lastFocused instanceof HTMLElement) lastFocused.focus();
}

/* ---------------------------------------------------------------------- */
/* Toast                                                                   */
/* ---------------------------------------------------------------------- */

/**
 * Show a short-lived toast notification.
 * @param {string} message
 * @param {{type?: 'info'|'warning'|'success', duration?: number}} [opts]
 */
export function toast(message, opts = {}) {
  const root = qs('#toast-root');
  if (!root) return;

  const el = document.createElement('div');
  el.className = `toast toast-${opts.type || 'info'}`;
  el.textContent = message;
  root.appendChild(el);

  requestAnimationFrame(() => el.classList.add('show'));

  const duration = opts.duration || 3200;
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, duration);
}

/* ---------------------------------------------------------------------- */
/* Prev / Next step footer                                                 */
/* ---------------------------------------------------------------------- */

/**
 * Build the HTML for a prev/next footer nav used at the bottom of the
 * Learn / Simulate / Analyze pages.
 * @param {{route: string, label: string}|null} prev
 * @param {{route: string, label: string}|null} next
 */
export function renderStepFooter(prev, next) {
  return `
    <div class="step-footer">
      <div class="step-footer-side">
        ${prev ? `<a class="btn btn-ghost" href="#${prev.route}">← ${prev.label}</a>` : ''}
      </div>
      <div class="step-footer-side step-footer-next">
        ${next ? `<a class="btn btn-primary" href="#${next.route}">${next.label} →</a>` : ''}
      </div>
    </div>
  `;
}

export default {
  JOURNEY_STEPS,
  qs,
  qsa,
  renderJourney,
  setActiveNav,
  openModal,
  closeModal,
  toast,
  renderStepFooter
};
