/**
 * navigation.js
 * -----------------------------------------------------------------------
 * A minimal hash-based router. Each route maps to a page module exposing
 * `render()` (returns an HTML string) and `init(container)` (wires up
 * interactivity), and optionally `dispose()` (cleanup on navigation away —
 * important for the Three.js scenes and any timers/animations a page
 * starts).
 *
 * Also responsible for:
 *  - toggling the light "Learn" / dark "Lab" body theme per route
 *  - showing/hiding + updating the 01..05 journey step bar
 *  - highlighting the active top-level nav link
 *  - basic document title updates
 */

import { qs, renderJourney, setActiveNav, closeModal } from './ui.js';

import * as homePage from './home.js';
import * as anatomyPage from './anatomy.js';
import * as osaPage from './osa.js';
import * as cpapPage from './cpap.js';
import * as simulationPage from './simulation.js';
import * as microscopicPage from './microscopic.js';
import * as analysisPage from './analysis.js';

const routes = {
  '/home': { module: homePage, theme: 'home', step: null, title: 'RESPIRA · Interactive Respiratory Model & Control Laboratory' },
  '/learn/anatomy': { module: anatomyPage, theme: 'learn', step: 1, title: 'Anatomy · RESPIRA' },
  '/learn/osa': { module: osaPage, theme: 'learn', step: 2, title: 'OSA · RESPIRA' },
  '/learn/cpap': { module: cpapPage, theme: 'learn', step: 3, title: 'CPAP · RESPIRA' },
  '/simulate': { module: simulationPage, theme: 'lab', step: 4, title: 'Simulation · RESPIRA' },
  '/simulate/microscopic': { module: microscopicPage, theme: 'lab', step: null, title: 'Microscopic View · RESPIRA' },
  '/analyze': { module: analysisPage, theme: 'analyze', step: 5, title: 'Analysis · RESPIRA' }
};

const DEFAULT_ROUTE = '/home';
const THEME_CLASSES = ['theme-home', 'theme-learn', 'theme-lab', 'theme-analyze'];

let currentModule = null;
let currentPath = null;

function parsePath() {
  const raw = window.location.hash.replace(/^#/, '');
  return raw || DEFAULT_ROUTE;
}

function applyTheme(theme) {
  document.body.classList.remove(...THEME_CLASSES);
  document.body.classList.add(`theme-${theme}`);
}

function render() {
  const path = parsePath();
  const route = routes[path] || routes[DEFAULT_ROUTE];
  const resolvedPath = routes[path] ? path : DEFAULT_ROUTE;

  // Close any open modal / dropdown before switching pages.
  closeModal();

  // Clean up the outgoing page (stops Three.js render loops, timers, etc).
  if (currentModule && typeof currentModule.dispose === 'function') {
    currentModule.dispose();
  }

  const appEl = qs('#app');
  appEl.innerHTML = route.module.render();

  applyTheme(route.theme);
  renderJourney(route.step);
  setActiveNav(resolvedPath);

  document.title = route.title;
  appEl.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

  route.module.init?.(appEl);

  currentModule = route.module;
  currentPath = resolvedPath;
}

/** Programmatic navigation helper (equivalent to setting location.hash). */
export function navigate(path) {
  if (window.location.hash === `#${path}`) {
    render();
  } else {
    window.location.hash = path;
  }
}

export function getCurrentPath() {
  return currentPath;
}

export function initRouter() {
  window.addEventListener('hashchange', render);
  render();

  // Learn dropdown open/close on click (works alongside plain <a href> nav).
  const trigger = qs('[data-route-group="learn"]');
  const dropdown = qs('#learn-dropdown');
  trigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle('open');
    trigger.setAttribute('aria-expanded', String(isOpen));
  });
  document.addEventListener('click', () => {
    dropdown?.classList.remove('open');
    trigger?.setAttribute('aria-expanded', 'false');
  });
  dropdown?.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => dropdown.classList.remove('open'));
  });
}

export default { initRouter, navigate, getCurrentPath };
