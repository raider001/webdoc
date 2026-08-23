// requirements/store.js - the shared in-memory index the requirements subsystem
// hangs off: the requirement + test record maps (populated from the server's
// coverage index), the per-document parsed block lists, the coverage-status map
// that colours badges, and the source->component lookup. Kept in one place so
// parse / render / the barrel share it WITHOUT an import cycle (only parse and
// render import this; it imports nothing). Extracted from requirements.js.
//
// WHY THIS FILE STAYS PUT (no move, no rename, no `.svelte.js`): app/index.html
// loads /js/main.js as a NATIVE es module, and this file is reachable from that
// graph through requirements.js / parse.js / render.js. Runes are a COMPILE-time
// transform - a `.svelte.js` file is not valid to a browser that never ran Vite
// over it - so nothing reachable from a native /js/ import may contain one.
// Hence the direction of the seam: this stays a plain module with a plain
// listener list, and the rune store (app/svelte/stores/coverage.svelte.js)
// subscribes to it from the compiled side. Vanilla pushes; Svelte listens.
// ---------------------------------------------------------------------------

/** @typedef {import('../requirements.js').RequirementEntry} RequirementEntry */
/** @typedef {import('../requirements.js').TestCaseEntry} TestCaseEntry */
/** @typedef {import('./parse.js').ReqOrTestBlock} ReqOrTestBlock */
/** @typedef {import('../coverage.js').CoverageStatus} CoverageStatus */

/** @type {Map<string, RequirementEntry>} requirement id -> record */
export const index = new Map();
/** @type {Map<string, TestCaseEntry>} test id -> record */
export const testIndex = new Map();
/** @type {Map<string, ReqOrTestBlock[]>} docId -> blocks (requirement group OR test case, in document order) */
export const groupsByDoc = new Map();

/** @type {Map<string, CoverageStatus>|Object<string, CoverageStatus>|null} set by the app so badges colour by status */
let coverageStatus = null;
/** @type {Object<string, string>} source name -> component id */
let componentBySource = {};

/**
 * Everyone who wants to know when the status map is REPLACED.
 *
 * The map is swapped wholesale (never mutated in place) by main.js and
 * coverage-view.js, so there is exactly one moment worth announcing and no need
 * for per-id granularity. A plain array of plain callbacks: see the header for
 * why this file cannot hold a rune.
 * @type {(() => void)[]}
 */
const statusListeners = [];

/**
 * Subscribe to coverage-status replacements.
 * @param {() => void} fn - called AFTER the new map is in place, so a callback
 *   that immediately calls statusOf() sees the new values, never the old ones
 * @returns {() => void} unsubscribe; safe to call more than once
 */
export function onStatusChange(fn) {
  statusListeners.push(fn);
  return () => {
    const i = statusListeners.indexOf(fn);
    if (i >= 0) statusListeners.splice(i, 1);
  };
}

/** @param {Map<string, CoverageStatus>|Object<string, CoverageStatus>|null} m @returns {void} */
export function setCoverageStatus(m) {
  coverageStatus = m;
  // Notify AFTER the swap, and defend the swap from its subscribers: a listener
  // that throws must not stop the remaining listeners running, and must not
  // propagate out of setCoverageStatus - its callers (a coverage refresh, a test
  // run finishing) would otherwise abort half-way through because of a rendering
  // bug. Iterated over a COPY because an unsubscribe from inside a callback would
  // otherwise shift the array underneath the loop and skip the next listener.
  statusListeners.slice().forEach(fn => {
    try { fn(); } catch (e) { /* one bad listener must not break a status update */ }
  });
}
/**
 * @param {string} id - a requirement or test id
 * @returns {CoverageStatus|null|undefined} null if no coverage status is set at
 *   all; undefined if it is set but has no entry for this id
 */
export function statusOf(id) {
  if (!coverageStatus) return null;
  // Duck-typed so either shape works. Testing for `.get` narrows nothing for the
  // checker - the plain-object arm's string index signature makes `.get` look
  // like a CoverageStatus rather than a method, and the Map arm has no index
  // signature at all - so each branch has to say which arm it is standing on.
  return coverageStatus.get
    ? /** @type {Map<string, CoverageStatus>} */ (coverageStatus).get(id)
    : /** @type {Object<string, CoverageStatus>} */ (coverageStatus)[id];
}
/** @param {Object<string, string>} map - source name -> component id @returns {void} */
export function setComponentBySource(map) { componentBySource = map; }
/** @param {string} source @returns {string|undefined} component id, or undefined if the source is unknown */
export function componentOf(source) { return componentBySource[source]; }
