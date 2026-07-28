// main.js - application entry point. Wires the shell together:
// theme, discovery, hash routing, the render pipeline, the drawer and search.
import { loadSite, loadDoc } from './catalog.js';
import { renderTree } from './tree.js';
import { searchDocs } from './search.js';
import { setupGraphButton } from './map-view.js';
import { setLinkSearch } from './editor.js';
import { loadResults } from './coverage.js';
import { openRunner } from './runner.js';
import { loadPlugins } from './plugins.js';
import { buildRequirementIndex, revealRequirement, revealTest, reqFromQuery, testFromQuery, requirementList, testList, setCoverageStatus } from './requirements.js';
import { state, el, combinedStatus, app, defaultId, getDoc } from './app-shell.js';
import { setupCoverageView } from './coverage-view.js';
import { renderDoc, setupDocSearch } from './reader.js';
import { setupEditButtons } from './authoring.js';
import { elem, append } from './dom.js';
import { html } from './html.js';
import { sunIcon, moonIcon } from './icons.js';

/** @typedef {import("./catalog.js").SourceConfig} SourceConfig */
/** @typedef {import("./coverage.js").CoverageResults} CoverageResults */
/** @typedef {import("./requirements.js").TestCaseEntry} TestCaseEntry */

/**
 * The drawer's open/close handle returned by setupDrawer(); stashed as
 * `appDrawer` and handed to setupDrawerSearch and app.closeDrawer.
 * @typedef {Object} DrawerHandle
 * @property {() => void} open
 * @property {() => void} close
 */

/**
 * Detail payload of the `webdoc:run-test` CustomEvent, dispatched by a
 * document's per-test-case Run button and consumed by setupTestRun.
 * @typedef {Object} RunTestEventDetail
 * @property {string} testId
 */

/**
 * The JSON body of GET /api/index/status, polled by waitForIndex while the
 * server builds its first-run SQLite index.
 * @typedef {Object} IndexStatus
 * @property {string} state - e.g. 'building' | 'ready' | 'error'
 * @property {number} pct - percent complete (0 while unknown)
 * @property {number} docs - documents indexed so far (0 while unknown)
 */

/**
 * The first-run index-build overlay's live DOM handle, held in the
 * module-level `indexOverlay` while the overlay is shown.
 * @typedef {Object} IndexOverlayHandle
 * @property {HTMLElement} ov - the overlay root, appended to <body>
 * @property {HTMLElement} track - the progress bar track (toggles .is-indeterminate)
 * @property {HTMLElement} fill - the progress bar fill (width set to a percentage)
 * @property {HTMLElement} stat - the status line text
 */

/**
 * The options object built for a single ad-hoc test run (triggered by a
 * document's per-test Run button) and handed to runner.js's openRunner, which
 * reads every field back out to render the run screen and later save results.
 * @typedef {Object} RunnerOpts
 * @property {TestCaseEntry[]} tests
 * @property {CoverageResults} results
 * @property {SourceConfig[]} sources
 * @property {() => void} onSaved
 */

// The drawer handle (open/close), created at boot; exposed to modules via app.closeDrawer.
/** @type {DrawerHandle|null} */
let appDrawer = null;

// ---- Theme ----------------------------------------------------------------
function setupTheme() {
  const btn = el('themeBtn'), root = document.documentElement;
  const sync = () => {
    const dark = root.getAttribute('data-theme') === 'dark';
    btn.setAttribute('aria-pressed', String(dark));
    btn.textContent = '';
    btn.appendChild(dark ? sunIcon() : moonIcon());
  };
  btn.addEventListener('click', () => {
    const dark = root.getAttribute('data-theme') === 'dark';
    const next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('wd-theme', next); } catch (e) {}
    sync();
  });
  sync();
}

// ---- Drawer ---------------------------------------------------------------
/** @returns {DrawerHandle} */
function setupDrawer() {
  const drawer = el('doc-tree'), scrim = el('scrim'), btn = el('hamburger');
  let lastFocus = null;
  const open = () => {
    lastFocus = document.activeElement;
    drawer.hidden = false; scrim.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.documentElement.style.overflow = 'hidden';
    (drawer.querySelector('#treeSearch') || drawer).focus();
  };
  const close = () => {
    drawer.hidden = true; scrim.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.documentElement.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  };
  btn.addEventListener('click', () => (drawer.hidden ? open() : close()));
  el('drawerClose').addEventListener('click', close);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) close(); });
  return { open, close };
}

// ---- All-documents search (titles + headings) in the drawer ---------------
/** @param {DrawerHandle} drawer */
function setupDrawerSearch(drawer) {
  const input = el('treeSearch');
  const results = el('searchResults');
  const tree = el('treeList');
  let seq = 0, ctrl = null, timer = null;
  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (timer) clearTimeout(timer);
    if (ctrl) { try { ctrl.abort(); } catch (e) {} ctrl = null; }
    if (!q) { results.hidden = true; results.textContent = ''; tree.hidden = false; return; }
    tree.hidden = true; results.hidden = false;
    // Debounce keystrokes; AbortController cancels the in-flight request; a sequence
    // guard drops out-of-order responses so results never flicker.
    timer = setTimeout(async () => {
      const mySeq = ++seq;
      ctrl = new AbortController();
      results.textContent = '';
      append(results, elem('p', 'search-empty', 'Searching…'));
      let hits = [];
      try { hits = await searchDocs(q, 50, ctrl.signal); } catch (e) { hits = []; }
      if (mySeq !== seq) return;   // superseded by a newer keystroke
      results.textContent = '';
      if (!hits.length) { append(results, elem('p', 'search-empty', 'No documents match “' + q + '”.')); return; }
      for (const hit of hits) {
        append(results, elem('a', {
          class: 'search-hit', href: '#/' + hit.docId,
          onClick: ev => { if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return; ev.preventDefault(); navigate(hit.docId); drawer.close(); }
        }, html`<span class="search-hit-title">${hit.title}</span>${hit.snippet && html`<span class="search-hit-sub">${hit.snippet}</span>`}`));
      }
    }, 200);
  });
}

// ---- Test coverage view -------------------------------------------------
// The full-screen Test Coverage overlay lives in ./coverage-view.js
// (setupCoverageView); it hangs its close() on app.closeCoverageView.

// ---- Routing --------------------------------------------------------------
/**
 * Hash-route handler: resolves the current #/<id>?req=...&test=... route to a
 * document (lazily loading it via getDoc/loadDoc), renders it, and reveals any
 * deep-linked requirement or test.
 * @returns {Promise<void>}
 */
async function route() {
  const hash = location.hash || '';
  if (!hash.startsWith('#/')) return; // ignore in-page anchors etc.
  const raw = hash.slice(2);
  const q = raw.indexOf('?');                      // split off ?req=<ID>
  const id = decodeURIComponent(q === -1 ? raw : raw.slice(0, q));
  const query = q === -1 ? '' : raw.slice(q + 1);
  const doc = getDoc(id) || getDoc(defaultId());   // lazy: id -> stub -> loadDoc on demand
  if (!doc) return showError('No documents found.');
  try {
    await loadDoc(doc);
    state.current = doc;
    renderDoc(doc);
    const reqId = reqFromQuery(query);             // deep-link to a requirement or test
    if (reqId) requestAnimationFrame(() => revealRequirement(reqId));
    const testId = testFromQuery(query);
    if (testId) requestAnimationFrame(() => revealTest(testId));
  } catch (e) {
    showError('Could not load "' + id + '": ' + e.message);
  }
}
function showError(msg) {
  const content = el('content');
  content.textContent = '';
  content.appendChild(elem('div', 'doc-error', msg));
}
function navigate(id) {
  if (location.hash === '#/' + id) route(); else location.hash = '#/' + id;
}

// Wire the shell's own handles onto the service registry so the feature modules
// (map, coverage, authoring) can route, report errors and close the drawer without
// importing main.js. The rest of the registry is set by those modules at load.
app.navigate = navigate;
app.showError = showError;
app.closeDrawer = () => { if (appDrawer) appDrawer.close(); };

/**
 * Per-test "Run" from a test-case block in a document: listens for the
 * `webdoc:run-test` CustomEvent ({@link RunTestEventDetail}), loads results,
 * opens the runner for that one test (via a {@link RunnerOpts}), and refreshes
 * badges after saving.
 */
function setupTestRun() {
  document.addEventListener('webdoc:run-test', async (e) => {
    const id = e.detail && e.detail.testId;
    const t = testList().find(x => x.id === id);
    if (!t) return;
    const res = await loadResults(state.site && state.site.sources);
    openRunner({
      tests: [t], results: res, sources: state.site && state.site.sources,
      onSaved: () => {
        setCoverageStatus(combinedStatus(requirementList(), testList(), res));
        if (state.current) renderDoc(state.current);
      }
    });
  });
}

// ---- First-run index build progress ---------------------------------------
// While the server builds its SQLite index for the first time on a large corpus,
// the /api/index/* endpoints aren't ready - so show a progress bar (driven by
// /api/index/status) instead of a blank app. Warm restarts report "ready" at once,
// so this returns immediately and nothing is shown.
/** @type {IndexOverlayHandle|null} */
let indexOverlay = null;
function showIndexOverlay() {
  if (indexOverlay) return;
  const fill = elem('div', 'index-progress-fill');
  const track = elem('div', 'index-progress is-indeterminate', fill);
  const stat = elem('div', 'index-loading-stat', 'Scanning files…');
  const brand = (state.site && state.site.siteTitle) || 'Documentation';
  const ov = html`
    <div class="index-loading">
      <div class="index-loading-card">
        <div class="index-loading-brand">${brand}</div>
        <div class="index-loading-title">Preparing the document index…</div>
        ${track}
        ${stat}
        <div class="index-loading-note">First-time indexing of this library. Later starts are near-instant.</div>
      </div>
    </div>
  `.firstElementChild;
  document.body.appendChild(ov);
  el('live').textContent = 'Preparing the document index.';
  indexOverlay = { ov: ov, track: track, fill: fill, stat: stat };
}
/** @param {IndexStatus} s */
function updateIndexOverlay(s) {
  if (!indexOverlay) return;
  const pct = Math.max(0, Math.min(100, s.pct || 0));
  const scanning = !pct && !s.docs;   // walk phase: total not known yet -> indeterminate
  indexOverlay.track.classList.toggle('is-indeterminate', scanning);
  if (!scanning) indexOverlay.fill.style.width = pct + '%';
  indexOverlay.stat.textContent = scanning
    ? 'Scanning files…'
    : (Number(s.docs || 0).toLocaleString() + ' documents indexed · ' + pct + '%');
}
function hideIndexOverlay() {
  if (!indexOverlay) return;
  indexOverlay.ov.remove();
  indexOverlay = null;
}
// Block boot until the server index is ready, showing progress if it's a cold build.
/** @returns {Promise<void>} */
async function waitForIndex() {
  for (;;) {
    let s;
    try {
      const r = await fetch('/api/index/status', { cache: 'no-cache' });
      if (!r.ok) break;              // index disabled / unavailable -> proceed (app degrades gracefully)
      s = await r.json();
    } catch (e) { break; }
    if (!s || s.state === 'ready' || s.state === 'error') break;
    showIndexOverlay();
    updateIndexOverlay(s);
    await new Promise(res => setTimeout(res, 600));
  }
  hideIndexOverlay();
}

// ---- Boot -----------------------------------------------------------------
/**
 * Application entry point: wires theme/drawer/search/graph/coverage/authoring,
 * loads site config and the server-backed requirement/test index, renders the
 * initial tree, and resolves the starting route.
 * @returns {Promise<void>}
 */
async function boot() {
  setupTheme();
  appDrawer = setupDrawer();
  setupDocSearch();
  setupGraphButton();
  setupCoverageView();
  setupEditButtons();
  setupTestRun();

  try {
    state.site = await loadSite();
  } catch (e) {
    return showError('Could not reach the server config. Is serve.py running? (' + e.message + ')');
  }
  el('brand').textContent = state.site.siteTitle || 'Documentation';

  // Load any opted-in renderer plugins (config "plugins"). Fault-tolerant: a
  // missing plugin or absent library is skipped, never blocking boot.
  await loadPlugins(state.site.plugins);

  // On a first-time cold index build, wait here with a progress bar (the tree /
  // search / map all need the index). Warm starts pass through instantly.
  await waitForIndex();

  // LAZY boot: do NOT discover + load every document body (the old ceiling). The
  // global requirement/test index comes from the server's SQLite index; individual
  // documents load on demand when viewed; the tree, all-docs search and the map are
  // all server-backed. Boot cost is now flat regardless of corpus size.
  state.docs = [];
  await buildRequirementIndex(null, state.site.sources);
  // Editor link autocomplete: server-backed title/id suggestions via the search index
  // (scales past any client-held document list).
  setLinkSearch(async q => (await searchDocs(q, 8)).map(h => ({ id: h.docId, title: h.title })));

  // Test-coverage status, so requirement badges in the tables colour by pass/fail.
  try {
    const cov = await loadResults(state.site && state.site.sources);
    setCoverageStatus(combinedStatus(requirementList(), testList(), cov));
  } catch (e) { /* no results -> badges stay neutral */ }

  await renderTree(el('treeList'), id => { navigate(id); appDrawer.close(); });
  setupDrawerSearch(appDrawer);

  window.addEventListener('hashchange', route);
  if (!location.hash || !location.hash.startsWith('#/')) {
    location.replace('#/' + defaultId());
  }
  await route();

  document.body.setAttribute('data-app-ready', '1');
}

boot();
