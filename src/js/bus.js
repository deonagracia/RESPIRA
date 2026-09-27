/**
 * bus.js
 * -----------------------------------------------------------------------
 * A minimal, dependency-free publish/subscribe event bus used to decouple
 * UI components from whatever will eventually consume their events (the
 * Phase 2+ simulation engine, PID controller, respiratory model, etc).
 *
 * UI modules (simulation.js, cpap.js, ...) only ever *emit* semantic
 * events such as "sim:start" or "cpap:toggle" — they never know or care
 * who is listening. This keeps Phase 1 fully functional on its own while
 * making it trivial to wire a real engine in later without touching the
 * UI code again.
 */

const target = new EventTarget();

/**
 * Emit an event on the shared bus.
 * @param {string} type - event name, e.g. "sim:start"
 * @param {*} [detail] - optional payload
 */
export function emit(type, detail) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

/**
 * Subscribe to an event on the shared bus.
 * @param {string} type
 * @param {(e: CustomEvent) => void} handler
 * @returns {() => void} unsubscribe function
 */
export function on(type, handler) {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}

/**
 * Subscribe to an event once.
 * @param {string} type
 * @param {(e: CustomEvent) => void} handler
 */
export function once(type, handler) {
  target.addEventListener(type, handler, { once: true });
}

export default { emit, on, once };
