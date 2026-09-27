/**
 * main.js — application entry point.
 *
 * Loads global styles, boots the router (which renders the initial page
 * from the current URL hash, defaulting to Home), and wires the one piece
 * of chrome that lives outside any single page: the "Compare Control"
 * modal button in the header.
 */

import './css/style.css';
import { initRouter } from './js/navigation.js';
import { initCompareControl } from './js/compareControl.js';
import { initEngine } from './js/simulationEngine.js';

document.addEventListener('DOMContentLoaded', () => {
  initRouter();
  initCompareControl();
  // Phase 2: the simulation physics loop is a persistent singleton — see
  // simulationEngine.js — started once here so it keeps running even
  // while the user is browsing pages other than "Simulate".
  initEngine();
});
