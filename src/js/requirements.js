// requirements.js - requirement groups AND test cases, with cross-document
// tracing. Two kinds of metadata-wrapped Markdown table are recognised:
//
//   <!--meta start {"requirement-group":"nav"}-->                  (requirements)
//   | requirement-no | description | trace-to |
//
//   <!--meta start {"test":"nav-tree","name":"...","verifies":["nav_1"]}-->  (a test case)
//   | action | expected response |
//
// TAGGING: every requirement id starts with  R_ , every test id starts with  T_ .
//   * Requirement id  R_{component}_{group}_{no}     e.g. R_WD_nav_1
//   * Test id         T_{component}_{key}            e.g. T_WD_nav-tree
//
// A TEST CASE is its own table: the meta header carries its id/name and the
// requirements it Verifies; each row is one step (an action + its expected
// response). Tracing is authored ON THE TEST (`verifies`); the requirement's
// "Verified By" column is the calculated inverse (a test may verify many
// requirements, and a requirement may be verified by many tests).
//
// This file is the entry/barrel: it owns the GLOBAL index build (from the server)
// + the list/deep-link API, and re-exports the public surface from the subsystem
// under ./requirements/: store.js (shared maps + status), parse.js (raw markdown
// -> block structures + ref resolution + the placeholder pass), render.js (block
// structures -> the in-document tables).
// ---------------------------------------------------------------------------
import { index, testIndex, groupsByDoc, setComponentBySource, componentOf } from './requirements/store.js';
import { extractGroups, resolveReqRef, cssSafe } from './requirements/parse.js';

export { setCoverageStatus } from './requirements/store.js';
export { resolveRequirementRef, preprocessRequirements } from './requirements/parse.js';
export { renderRequirements, blockMarkdown, inlineMarkdown } from './requirements/render.js';

/** @typedef {import('./catalog.js').Doc} Doc */
/** @typedef {import('./catalog.js').SourceConfig} SourceConfig */
/** @typedef {import('./requirements/parse.js').ReqOrTestBlock} ReqOrTestBlock */

/**
 * One test-case step: an action and its expected response. Same shape as the
 * editor's own step objects (editor/widgets.js's TestStep) - structured data in
 * the meta header now (any markdown allowed), though older docs kept steps in a
 * table (requirements/parse.js's extractTestCase reads both forms).
 * @typedef {import('./editor/widgets.js').TestStep} TestStep
 */

/**
 * One requirement record (an R_ id). Built per-document by requirements/parse.js's
 * extractReqGroup and, in fuller form (with resolved traceFrom/verifiedBy), from
 * the server's global coverage index by buildRequirementIndex/requirementList.
 * @typedef {Object} RequirementEntry
 * @property {string} id
 * @property {string} docId
 * @property {string} component
 * @property {string} group
 * @property {string} no
 * @property {string} description
 * @property {string[]} traceTo
 * @property {string[]} traceFrom
 * @property {string[]} verifiedBy
 */

/**
 * One test-case record (a T_ id). Built per-document by requirements/parse.js's
 * extractTestCase and, in fuller form, from the server's global index by
 * buildRequirementIndex/testList.
 * @typedef {Object} TestCaseEntry
 * @property {string} id
 * @property {string} docId
 * @property {string} component
 * @property {string} key
 * @property {string} name
 * @property {TestStep[]} steps
 * @property {string[]} [verifiesRaw] - the ids exactly as authored. Optional
 *   because testList()'s projection deliberately drops it and carries only the
 *   resolved `verifies`.
 * @property {string[]} verifies
 */

/**
 * A plain doc-to-doc reference pair. The same {from,to} shape is independently
 * produced twice - as requirement-trace edges (requirementTraceEdges, below) and
 * as in-body page-link edges (doclinks.js) - and consumed identically by the graph.
 * @typedef {Object} DocEdgeRef
 * @property {string} from
 * @property {string} to
 */

// Build the GLOBAL requirement/test index from the server's SQLite index (composed
// ids + resolved trace-from / verified-by / verifies). This used to scan every doc
// body at boot - the wall that capped the corpus. Now the server computes it and the
// browser fetches a compact list; per-document block STRUCTURE (for the in-document
// tables) is parsed on demand from the displayed doc only (prepareDocGroups).
/**
 * @param {Doc[]|null} _docs - not read by this function; every current call site
 *   passes null now that the index comes from the server instead of being built
 *   by scanning docs. Underscored, not dropped: the exported signature is the
 *   API third-party renderer plugins import.
 * @param {SourceConfig[]} sources
 * @returns {Promise<void>}
 */
export async function buildRequirementIndex(_docs, sources) {
  index.clear();
  testIndex.clear();
  groupsByDoc.clear();
  /** @type {Object<string, string>} */
  const cbs = {};
  for (const s of sources || []) cbs[s.name] = s.component;
  setComponentBySource(cbs);

  let data = null;
  try {
    const res = await fetch('/api/index/coverage', { cache: 'no-cache' });
    if (res.ok) data = await res.json();
  } catch (e) { /* index unavailable -> empty (badges/map stay neutral) */ }
  if (!data) return;
  for (const r of data.requirements || []) {
    index.set(r.id, {
      id: r.id, docId: r.docId, component: r.component, group: r.group, no: r.no,
      description: r.description || '', traceTo: (r.traceTo || []).slice(),
      traceFrom: (r.traceFrom || []).slice(), verifiedBy: (r.verifiedBy || []).slice()
    });
  }
  for (const t of data.tests || []) {
    testIndex.set(t.id, {
      id: t.id, docId: t.docId, component: t.component, key: t.key, name: t.name || t.id,
      steps: t.steps || [], verifiesRaw: (t.verifies || []).slice(), verifies: (t.verifies || []).slice()
    });
  }
}

/**
 * Parse the CURRENT document's requirement/test blocks from its (already-loaded)
 * body and stash them for renderRequirements, enriched with the global trace-from /
 * verified-by / verifies resolved by the server. Only the displayed doc is parsed.
 * @param {string} body - raw markdown
 * @param {string} docId
 * @param {string} source - source name, for component lookup (see componentOf)
 * @returns {ReqOrTestBlock[]}
 */
export function prepareDocGroups(body, docId, source) {
  const component = componentOf(source);
  const blocks = extractGroups(String(body || ''), { id: docId, source: source }, component);
  for (const b of blocks) {
    if (b.kind === 'req') {
      for (const rec of b.rows) {
        const g = index.get(rec.id);
        if (g) { rec.traceFrom = g.traceFrom || []; rec.verifiedBy = g.verifiedBy || []; }
      }
    } else if (b.kind === 'test' && b.rec) {
      const g = testIndex.get(b.rec.id);
      if (g) b.rec.verifies = (g.verifies || []).slice();
    }
  }
  groupsByDoc.set(docId, blocks);
  return blocks;
}

/**
 * Every known requirement (for the coverage rollup and the editor picker).
 * @returns {RequirementEntry[]} sorted by id
 */
export function requirementList() {
  return [...index.values()]
    .map(r => ({
      id: r.id, description: r.description || '', docId: r.docId, group: r.group,
      component: r.component, no: r.no,
      traceTo: (r.traceTo || []).slice(),
      traceFrom: (r.traceFrom || []).slice(),
      verifiedBy: (r.verifiedBy || []).slice()   // calculated test ids
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every known test case (for the coverage rollup, graph, runner and editor).
 * @returns {TestCaseEntry[]} sorted by id (verifiesRaw is omitted from this
 *   projection - only the resolved verifies list is included)
 */
export function testList() {
  return [...testIndex.values()]
    .map(t => ({
      id: t.id, name: t.name || '', key: t.key, docId: t.docId, component: t.component,
      steps: (t.steps || []).map(s => ({ action: s.action, expected: s.expected })),
      verifies: (t.verifies || []).slice()
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Deep-link: scroll a requirement or test into view and flash it.
/** @param {string} prefix - the element-id prefix, 'req-' or 'test-' @param {string} id @returns {void} */
function reveal(prefix, id) {
  if (!id) return;
  const el = document.getElementById(prefix + cssSafe(id));
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('req-flash');
  setTimeout(() => el.classList.remove('req-flash'), 1600);
}
/** @param {string} reqId @returns {void} */
export function revealRequirement(reqId) { reveal('req-', reqId); }
/** @param {string} testId @returns {void} */
export function revealTest(testId) { reveal('test-', testId); }

// Pull ?req=<id> / ?test=<id> out of a hash-route query string.
//
// The query deliberately lives INSIDE the hash (#/<docId>?req=<ID>) rather than
// in location.search. It belongs to the route, and the route is the hash: a real
// search string would survive every later hash navigation, so moving to another
// document would carry a stale ?req= naming a requirement that is not on the new
// page. Assigning location.search also RELOADS the document, which would turn
// every requirement link into a full app restart.
//
// Two hand-rolled regexes did this until Phase 2. URLSearchParams already knows
// about separators, repeated keys and percent-decoding, and unlike two
// near-identical patterns it cannot drift out of agreement with itself.
/**
 * @param {string} query - the part of the hash route after '?', without the '?'
 * @returns {{req: string|null, test: string|null}}
 */
export function routeParams(query) {
  const p = new URLSearchParams(query || '');
  return { req: p.get('req'), test: p.get('test') };
}

/**
 * Document -> document trace edges, for the map view's requirement-trace layer.
 * @returns {DocEdgeRef[]}
 */
export function requirementTraceEdges() {
  const seen = new Set();
  const edges = [];
  for (const rec of index.values()) {
    for (const raw of rec.traceTo) {
      const target = resolveReqRef(raw, rec);
      if (!target) continue;
      const toDoc = index.get(target).docId;
      if (toDoc === rec.docId) continue;
      const key = rec.docId + ' ' + toDoc;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: rec.docId, to: toDoc });
    }
  }
  return edges;
}
