// coverage-view.js - the full-screen Test Coverage overlay: the requirement/test
// status graph, the status legend filter, the per-node report panel (steps, run
// info, verifying-test linking, automated-test connection) and the exportable HTML
// report. Extracted from main.js; cross-cutting handles (closing the other overlay,
// linking tests to requirements) come through the shared `app` registry.
import { elem, append } from './dom.js';
import { state, el, downloadFile, isoDate, combinedStatus, app } from './app-shell.js';
import { requirementList, testList, setCoverageStatus } from './requirements.js';
import { loadResults, computeCoverage, computeTestStatus, testsFor } from './coverage.js';
import { generateReportHtml } from './report.js';
import { createGraph } from './graph.js';
import { showReport } from './coverage-report.js';

/** @typedef {import('./requirements.js').RequirementEntry} RequirementEntry */
/** @typedef {import('./requirements.js').TestCaseEntry} TestCaseEntry */
/** @typedef {import('./coverage.js').CoverageResults} CoverageResults */
/** @typedef {import('./coverage.js').CoverageStatus} CoverageStatus */

/**
 * The single input object generateReportHtml() (report.js) takes to build the
 * whole standalone, shareable HTML test report; assembled once by exportReport().
 * @typedef {Object} TestReportData
 * @property {string} title
 * @property {string} generatedAt
 * @property {RequirementEntry[]} requirements
 * @property {TestCaseEntry[]} tests
 * @property {Map<string, CoverageStatus>} reqStatus
 * @property {Map<string, CoverageStatus>} testStatus
 * @property {({id:string} & import('./coverage.js').TestEvidence & {run: import('./runner.js').TestRunMeta|null})[]} detail
 */

/**
 * The small context object (`cov`) handed to coverage-report.js's panel
 * builders, giving them the panel DOM, a live-results getter/setter, and
 * callbacks to rebuild the graph or close the overlay - lets the detail-panel
 * module stay decoupled from the overlay's own state.
 * @typedef {Object} CovContext
 * @property {HTMLElement} panel
 * @property {HTMLElement} resizeHandle
 * @property {() => CoverageResults} results
 * @property {(r: CoverageResults) => void} setResults
 * @property {() => void} renderGraph
 * @property {() => void} close
 */

let covApi = null;
let covTransform = null;   // last pan/zoom of the coverage map, persisted across reopen + rebuilds
/**
 * Wire up the full-screen Test Coverage overlay (button, legend, resize grip,
 * detail panel) and expose close() through the shared `app` registry.
 * @returns {void}
 */
export function setupCoverageView() {
  const btn = el('covBtn');
  const stage = elem('div');
  const legend = elem('div', 'cov-legend');
  const panel = elem('aside', { class: 'cov-report', hidden: true });
  const overlay = elem('div', { class: 'graph-overlay cov-overlay', id: 'covOverlay', hidden: true },
    stage,
    legend,
    // Export a self-contained, shareable test report (downloads an .html file).
    elem('button', { class: 'cov-export-btn', type: 'button', title: 'Download a self-contained test report (HTML) you can share anywhere', onClick: () => exportReport() }, '⤓ Export report'),
    panel);
  document.body.appendChild(overlay);

  // Status legend, each entry a toggle that hides/shows nodes of that status
  // (and any edges that touch a hidden node), like the map's category legend.
  const statusOff = new Set();
  /** Sync the current legend on/off filter to the canvas renderer. */
  function applyStatusFilter() {
    // Canvas draw-state (was per-node DOM display toggles): the renderer culls
    // hidden-status nodes and any edge touching one.
    if (covApi && covApi.setStatusFilter) covApi.setStatusFilter(statusOff);
  }
  [['pass', 'Passing'], ['fail', 'Failing'], ['partial', 'Partial'], ['untested', 'Untested']].forEach(([k, label]) => {
    const item = elem('button', { type: 'button', class: 'cov-legend-item', 'aria-pressed': 'true', title: 'Toggle ' + label + ' requirements' },
      elem('span', 'cov-swatch cov-swatch-' + k), label);
    item.addEventListener('click', () => {
      const off = !statusOff.has(k);
      if (off) statusOff.add(k); else statusOff.delete(k);
      item.classList.toggle('is-off', off);
      item.setAttribute('aria-pressed', off ? 'false' : 'true');
      applyStatusFilter();
    });
    append(legend, item);
  });

  // Left-edge grip to drag the report panel wider/narrower (persists per session).
  const resizeHandle = elem('div', { class: 'cov-report-resize', title: 'Drag to resize' });
  resizeHandle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX, startW = panel.getBoundingClientRect().width;
    try { resizeHandle.setPointerCapture(e.pointerId); } catch (err) {}
    const move = (ev) => { panel.style.width = Math.min(window.innerWidth - 60, Math.max(320, startW + (startX - ev.clientX))) + 'px'; };
    const up = () => { resizeHandle.removeEventListener('pointermove', move); resizeHandle.removeEventListener('pointerup', up); };
    resizeHandle.addEventListener('pointermove', move);
    resizeHandle.addEventListener('pointerup', up);
  });

  let results = null;

  /**
   * Build (or REBUILD) the graph from the current index + results. Called on
   * open and again whenever a requirement<->test link changes, so the view
   * (nodes AND edges) reflects an add/remove immediately.
   */
  const renderGraph = () => {
    const reqs = requirementList();
    if (!reqs.length) { if (covApi) { covApi.destroy(); covApi = null; } stage.innerHTML = '<p class="cov-empty">No requirements found to test.</p>'; return; }
    const tests = testList();
    const status = combinedStatus(reqs, tests, results);
    setCoverageStatus(status);   // keep in-document badges (requirement + test tables) in sync
    const parents = {}; reqs.forEach(r => (parents[r.id] = []));
    reqs.forEach(p => (p.traceFrom || []).forEach(c => { if (parents[c]) parents[c].push(p.id); }));
    const reqPseudo = reqs.map(r => ({ id: r.id, title: r.id, description: r.description, assumes: parents[r.id] || [], next: [] }));
    // Test cases are their own nodes, linked FROM each requirement they verify
    // (assumes = verifies -> a prereq edge requirement -> test).
    const testPseudo = tests.map(t => ({
      id: t.id, title: t.name || t.id,
      description: (t.steps || []).length + ' step' + ((t.steps || []).length === 1 ? '' : 's'),
      assumes: (t.verifies || []).slice(), next: []
    }));
    const nodeKind = new Map();
    reqs.forEach(r => nodeKind.set(r.id, 'req'));
    tests.forEach(t => nodeKind.set(t.id, 'test'));
    if (covApi) { covTransform = covApi.getTransform(); covApi.destroy(); }   // remember the live view before rebuild
    covApi = createGraph(stage, reqPseudo.concat(testPseudo), {
      nodeStatus: status, nodeKind: nodeKind, hideLegend: true,
      autoSize: true, maxNodeW: 360, maxNodeH: 240,   // size boxes to fit the largest node
      initialTransform: covTransform,                 // restore last pan/zoom (null on first open -> fit)
      onSelect: (id) => showReport(id, cov),
      onActivate: (id) => showReport(id, cov)
    });
    applyStatusFilter();   // keep any active legend filter across reopen/rebuild
  };

  /** Open the coverage overlay, loading results and rendering the graph. */
  const open = async () => {
    if (app.closeMapView) app.closeMapView();     // only one overlay view at a time
    overlay.hidden = false;
    btn.setAttribute('aria-pressed', 'true');
    panel.hidden = true;
    results = await loadResults(state.site && state.site.sources);
    renderGraph();
    el('live').textContent = 'Opened the test coverage view. Click a requirement for its test report.';
  };
  /** Close the coverage overlay, remembering its pan/zoom transform. */
  const close = () => {
    if (overlay.hidden) return;
    overlay.hidden = true;
    btn.setAttribute('aria-pressed', 'false');
    if (covApi) { covTransform = covApi.getTransform(); covApi.destroy(); covApi = null; }   // remember the view
  };

  /** @type {CovContext} */
  const cov = {
    panel: panel, resizeHandle: resizeHandle,
    results: () => results,
    setResults: (r) => { results = r; },
    renderGraph: renderGraph, close: close
  };

  /** Build and download a self-contained, shareable Test Coverage Report. */
  async function exportReport() {
    const res = results || await loadResults(state.site && state.site.sources);
    const reqs = requirementList();
    const tests = testList();
    const now = new Date();
    const html = generateReportHtml({
      title: (state.site && state.site.siteTitle) || 'WebDocs',
      generatedAt: now.toLocaleString(),
      requirements: reqs,
      tests: tests,
      reqStatus: computeCoverage(reqs, res),
      testStatus: computeTestStatus(tests, res),
      detail: tests.map(t => {
        const d = Object.assign({ id: t.id }, testsFor(t.id, res));
        const m = res.manual[t.id];
        d.run = (m && m.run) ? m.run : null;   // run metadata (when / who)
        return d;
      })
    });
    const base = ((state.site && state.site.siteTitle) || 'webdocs').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'webdocs';
    downloadFile(base + '-test-report-' + isoDate(now) + '.html', html, 'text/html');
    el('live').textContent = 'Test report downloaded.';
  }

  // Recompute status and repaint node colours in place (keeps pan/zoom).
  function recolor() {
    const status = combinedStatus(requirementList(), testList(), results);
    setCoverageStatus(status); // keep the in-document table badges (requirement + test) in sync too
    if (covApi && covApi.setStatus) covApi.setStatus(status);   // repaint node colours on the canvas
    applyStatusFilter();   // a node's status may have changed; re-apply the legend filter
  }

  app.closeCoverageView = close;
  btn.addEventListener('click', () => (overlay.hidden ? open() : close()));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) { if (!panel.hidden) panel.hidden = true; else close(); } });
}
