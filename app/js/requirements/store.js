// requirements/store.js - the shared in-memory index the requirements subsystem
// hangs off: the requirement + test record maps (populated from the server's
// coverage index), the per-document parsed block lists, the coverage-status map
// that colours badges, and the source->component lookup. Kept in one place so
// parse / render / the barrel share it WITHOUT an import cycle (only parse and
// render import this; it imports nothing). Extracted from requirements.js.
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

/** @param {Map<string, CoverageStatus>|Object<string, CoverageStatus>|null} m @returns {void} */
export function setCoverageStatus(m) { coverageStatus = m; }
/**
 * @param {string} id - a requirement or test id
 * @returns {CoverageStatus|null|undefined} null if no coverage status is set at
 *   all; undefined if it is set but has no entry for this id
 */
export function statusOf(id) {
  if (!coverageStatus) return null;
  return coverageStatus.get ? coverageStatus.get(id) : coverageStatus[id];
}
/** @param {Object<string, string>} map - source name -> component id @returns {void} */
export function setComponentBySource(map) { componentBySource = map; }
/** @param {string} source @returns {string|undefined} component id, or undefined if the source is unknown */
export function componentOf(source) { return componentBySource[source]; }
