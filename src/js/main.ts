// main.ts - application entry point. Wires the shell together:
// theme, discovery, hash routing, the render pipeline, the drawer and search.
import { loadSite, loadDoc } from './catalog.js';
import { searchDocs } from './search.js';
import { invalidateGraphModel } from './graph-model.js';
import { ensureOverlayHosts, requestMapRebuild } from './overlays.js';
import { setLinkSearch } from './editor/richtext.js';
import { loadResults, combinedStatus } from './coverage.js';
import { loadPlugins } from './plugins.js';
import { buildRequirementIndex, revealRequirement, revealTest, routeParams, requirementList, testList, setCoverageStatus } from './requirements.js';
import { state, el, mustEl, app, defaultId, getDoc } from './app-shell.js';
import { loadIslands } from './islands.js';
import { renderDoc, setupDocSearch, registerMounted, teardownMounted } from './reader.js';
import { setupEditButtons } from './authoring.js';
import { elem } from './dom.js';
import { html } from './html.js';
import { sunIcon, moonIcon } from './icons.js';
import { auth, loadAuth, signInRequired, invalidateAccess } from './auth.js';
import { setupAccountButton, mountSignInWall, restrictedPanel } from './auth-ui.js';
import { announce } from './announce.js';

import type { RestrictedDetail, SourceConfig } from './catalog.js';
import type { CoverageResults } from './coverage.js';
import type { TestCaseEntry } from './requirements.js';
import type { SearchResult } from './search.js';
import type { IslandModule } from './islands.js';
import type { OverlayHandle } from './map-view.js';

/**
 * The drawer's open/close handle returned by setupDrawer(); stashed as
 * `appDrawer` and handed to setupDrawerSearch and app.closeDrawer.
 */
interface DrawerHandle {
  open: () => void;
  close: () => void;
}

/**
 * Detail payload of the `webdoc:run-test` CustomEvent, dispatched by a
 * document's per-test-case Run button and consumed by setupTestRun.
 */
export interface RunTestEventDetail {
  testId: string;
}

// The event is dispatched on `document` by TestCase.svelte and ReportPanel.svelte
// and listened for exactly once, in setupTestRun. Declaring it on DocumentEventMap
// is what makes that listener's parameter the real CustomEvent it receives instead
// of a bare Event the handler would have to cast back.
declare global {
  interface DocumentEventMap {
    'webdoc:run-test': CustomEvent<RunTestEventDetail>;
  }
}

/**
 * The JSON body of GET /api/index/status, polled by waitForIndex while the
 * server builds its first-run SQLite index - and again, on a timer, by
 * pollForChanges, which watches `generation` for an external edit.
 */
interface IndexStatus {
  /** e.g. 'building' | 'ready' | 'error' */
  state: string;
  /** percent complete (0 while unknown) */
  pct: number;
  /** documents indexed so far (0 while unknown) */
  docs: number;
  /** bumped by the server every time it rescans and finds the corpus changed */
  generation?: number;
}

/**
 * The first-run index-build overlay's live DOM handle, held in the
 * module-level `indexOverlay` while the overlay is shown.
 */
interface IndexOverlayHandle {
  /** the overlay root, appended to <body> */
  ov: Element;
  /** the progress bar track (toggles .is-indeterminate) */
  track: HTMLElement;
  /** the progress bar fill (width set to a percentage) */
  fill: HTMLElement;
  /** the status line text */
  stat: HTMLElement;
}

/**
 * The options object built for a single ad-hoc test run (triggered by a
 * document's per-test Run button) and handed to runner.js's openRunner, which
 * reads every field back out to render the run screen and later save results.
 */
export interface RunnerOpts {
  tests: TestCaseEntry[];
  results: CoverageResults;
  sources: SourceConfig[];
  onSaved: () => void;
}

// The drawer handle (open/close), created at boot; exposed to modules via app.closeDrawer.
let appDrawer: DrawerHandle | null = null;

// ---- Theme ----------------------------------------------------------------
function setupTheme() {
  const btn = mustEl('themeBtn'), root = document.documentElement;
  const sync = () => {
    const dark = root.getAttribute('data-theme') === 'dark';
    btn.setAttribute('aria-pressed', String(dark));
    btn.textContent = '';
    // The icon builders return the fragment's firstElementChild, so they are
    // typed nullable; a button with no glyph beats a boot that throws over one.
    const icon = dark ? sunIcon() : moonIcon();
    if (icon) btn.appendChild(icon);
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

// ---- The drawer island ----------------------------------------------------
/**
 * Mount the Svelte drawer tree and search-results list, and publish the two
 * calls the rest of the shell makes into them on the `app` registry.
 *
 * The registry, not an import: reader.ts marks the active document on EVERY
 * render and authoring.ts invalidates after every create/delete, and neither
 * should have to await a dynamic import on a hot path or grow a dependency on
 * the bundle. Both call sites already guard (`if (app.setTreeActive)`), so the
 * shell degrades to an unhighlighted tree rather than throwing if the island
 * ever fails to load.
 */
async function mountShellIslands(): Promise<void> {
  const select = (id: string) => { navigate(id); if (appDrawer) appDrawer.close(); };
  const islands = await loadIslands();

  // Drawer.
  islands.mountDocTree(mustEl('treeList'), select);
  islands.mountSearchHits(mustEl('searchResults'), select);
  app.setTreeActive = islands.setActive;
  app.invalidateTree = islands.invalidateTree;

  // The article's teardown registry, published so a module that MOUNTS something
  // inside the article can register it without importing reader.ts. auth-ui.ts is
  // the first caller and the reason this is a registry entry at all: reader.ts
  // imports auth-ui.ts for the restricted-section notice, so the reverse import
  // would close a cycle.
  app.registerMounted = registerMounted;

  // Reading-view satellites. Mounted ONCE, here, and driven by props for the
  // rest of the session - see app/svelte/islands/reader.js for why.
  islands.mountCrumbs(mustEl('crumbs'));
  islands.mountToc(mustEl('tocList'), mustEl('content'));
  islands.mountFooter(mustEl('footPrev'), mustEl('footNext'));
  app.setDocChrome = (docId, toc, assumes, next) => {
    islands.setCrumbs(docId);
    islands.setToc(toc);
    islands.setFootLinks(assumes, next);
    // Apply NOW, not on the next microtask: reader.ts reads the produced TOC
    // links back in this same tick for scroll-spy, and boot sets
    // data-app-ready="1" as soon as route() returns.
    islands.flushSync();
  };

  searchIsland = islands;
  if (state.current) islands.setActive(state.current.id);
}
// The island's export surface, stashed at mount so setupDrawerSearch can push
// results into the store without re-importing the bundle on every keystroke.
let searchIsland: IslandModule | null = null;

// ---- Lazy feature modules -------------------------------------------------
/**
 * Wire a header button to a feature module that is only fetched when the button
 * is first pressed.
 *
 * The map (map-view.js -> graph.js -> graph/*.js, ~2,000 lines) and the coverage
 * view (which pulls the graph AND the report generator) used to be imported
 * statically here, so every reader downloaded and parsed both just to read one
 * page, whether or not they ever opened either.
 *
 * The setup function returns an OverlayHandle rather than wiring the button
 * itself: by the time the module has loaded, the click that triggered the load
 * is over, so THIS listener has to open it for that first press. If the module
 * also attached its own listener, every later click would toggle twice.
 */
function lazyOverlayButton(btnId: string, load: () => Promise<OverlayHandle>): void {
  const btn = mustEl(btnId);
  let ready: Promise<OverlayHandle> | null = null;
  btn.addEventListener('click', async () => {
    const first = !ready;
    if (!ready) ready = load();
    let handle: OverlayHandle;
    try {
      handle = await ready;
    } catch (e) {
      ready = null;                       // a failed fetch can be retried by pressing again
      return showError('Could not load that view: ' + e.message);
    }
    await (first ? handle.open() : handle.toggle());
  });
}

// ---- Drawer ---------------------------------------------------------------
function setupDrawer(): DrawerHandle {
  const drawer = mustEl('doc-tree'), scrim = mustEl('scrim'), btn = mustEl('hamburger');
  /** Where focus was before the drawer took it, to hand back on close. */
  let lastFocus: HTMLElement | null = null;
  const open = () => {
    lastFocus = document.activeElement as HTMLElement;
    drawer.hidden = false; scrim.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.documentElement.style.overflow = 'hidden';
    ((drawer.querySelector('#treeSearch') || drawer) as HTMLElement).focus();
  };
  const close = () => {
    drawer.hidden = true; scrim.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.documentElement.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  };
  btn.addEventListener('click', () => (drawer.hidden ? open() : close()));
  mustEl('drawerClose').addEventListener('click', close);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) close(); });
  return { open, close };
}

// ---- All-documents search (titles + headings) in the drawer ---------------
function setupDrawerSearch() {
  const input = mustEl('treeSearch') as HTMLInputElement;
  const results = mustEl('searchResults');
  const tree = mustEl('treeList');
  let seq = 0, ctrl: AbortController | null = null,
    timer: ReturnType<typeof setTimeout> | null = null;
  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (timer) clearTimeout(timer);
    if (ctrl) { try { ctrl.abort(); } catch (e) {} ctrl = null; }
    // #searchResults and #treeList are the islands' MOUNT TARGETS, so their
    // hidden flags stay here - a component cannot set an attribute on the element
    // it was mounted into.
    if (!q) { results.hidden = true; tree.hidden = false; return; }
    tree.hidden = true; results.hidden = false;
    // The FETCHING stays vanilla and unchanged. Debounce keystrokes; the
    // AbortController cancels the in-flight request; the sequence guard drops
    // out-of-order responses. BOTH guards are needed - aborting only rejects the
    // fetch, while a response that already parsed can still resolve late.
    // Only the RENDERING moved: the island draws whatever lands in the store.
    timer = setTimeout(async () => {
      const mySeq = ++seq;
      ctrl = new AbortController();
      if (searchIsland) searchIsland.beginSearch(q);
      let hits: SearchResult[] = [];
      try { hits = await searchDocs(q, 50, ctrl.signal); } catch (e) { hits = []; }
      if (mySeq !== seq) return;   // superseded by a newer keystroke
      if (searchIsland) searchIsland.showHits(hits);
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
 */
async function route(): Promise<void> {
  const hash = location.hash || '';
  if (!hash.startsWith('#/')) return; // ignore in-page anchors etc.
  const raw = hash.slice(2);
  const q = raw.indexOf('?');                      // split off ?req=<ID>
  const id = decodeURIComponent(q === -1 ? raw : raw.slice(0, q));
  const query = q === -1 ? '' : raw.slice(q + 1);
  // lazy: id -> stub -> loadDoc on demand. defaultId() is undefined when neither a
  // configured defaultDoc nor a cached doc exists, which is the same "nothing to
  // fall back to" the !doc branch below already reports.
  const fallback = defaultId();
  const doc = getDoc(id) || (fallback ? getDoc(fallback) : null);
  if (!doc) return showError('No documents found.');
  try {
    await loadDoc(doc);
    state.current = doc;
    renderDoc(doc);
    const { req, test } = routeParams(query);      // deep-link to a requirement or test
    if (req) requestAnimationFrame(() => revealRequirement(req));
    if (test) requestAnimationFrame(() => revealTest(test));
  } catch (e) {
    // A restricted page is not an error - it is a page with a different body.
    // loadDoc attaches the server's refusal so the reader is told which groups
    // would open it rather than being shown "could not load".
    if (e && e.restricted) return showRestricted(doc.id, e.detail || {});
    showError('Could not load "' + id + '": ' + e.message);
  }
}
/**
 * Render the "this page is restricted" screen in place of the document, and
 * reset the chrome around it so nothing from the previous page lingers.
 */
function showRestricted(docId: string, detail: RestrictedDetail): void {
  // Clear the current document first. Leaving it set meant Edit and Delete stayed
  // armed for the page the reader was on BEFORE hitting the restricted one - the
  // buttons acted on a document that is no longer what they are looking at.
  state.current = null;
  mustEl('editBtn').hidden = true;
  mustEl('deleteBtn').hidden = true;
  const content = mustEl('content');
  teardownMounted(content);          // the restricted panel replaces the article
  content.textContent = '';
  // restrictedPanel() returns a `.wd-mounted` host straight away and mounts the
  // island into it once the bundle resolves; it registers its own teardown
  // through app.registerMounted, so the NEXT navigation's teardownMounted()
  // above destroys it. Appending must come first - the pending mount checks that
  // the host is still connected, which is how a reader who routes away in that
  // one microtask does not leave a component running against a detached node.
  content.appendChild(restrictedPanel(docId, detail));
  // Through the store, not by writing #tocList / #crumbs directly: those are the
  // satellites' MOUNT TARGETS now, and a direct write would be reverted the next
  // time the component updated - or, worse, would fight it silently.
  if (app.setDocChrome) app.setDocChrome(docId, [], [], []);
  mustEl('footPrev').hidden = true;
  mustEl('footNext').hidden = true;
  const tocPane = el('toc');
  if (tocPane) tocPane.hidden = true;
  document.title = 'Restricted — ' + ((state.site && state.site.siteTitle) || 'Documentation');
  announce('This page is restricted.');
}
function showError(msg: string) {
  // mustEl, not el: a missing #content here is exactly the case the boot catch
  // below wraps in its own try/catch and falls back to <body> for.
  const content = mustEl('content');
  teardownMounted(content);          // this replaces the article too
  content.textContent = '';
  content.appendChild(elem('div', 'doc-error', msg));
}
function navigate(id: string) {
  if (location.hash === '#/' + id) route(); else location.hash = '#/' + id;
}

// Wire the shell's own handles onto the service registry so the feature modules
// (map, coverage, authoring) can route, report errors and close the drawer without
// importing main.ts. The rest of the registry is set by those modules at load.
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
    const sources = (state.site && state.site.sources) || [];
    const res = await loadResults(sources);
    // runner.js imports editor.js (for richText), so it drags the whole editor
    // graph. Fetch it only when a reader actually presses Run on a test case.
    const { openRunner } = await import('./runner.js');
    openRunner({
      tests: [t], results: res, sources: sources,
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
let indexOverlay: IndexOverlayHandle | null = null;
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
  `.firstElementChild!;   // the template above has exactly one root <div>, so never null
  document.body.appendChild(ov);
  announce('Preparing the document index.');
  indexOverlay = { ov: ov, track: track, fill: fill, stat: stat };
}
function updateIndexOverlay(s: IndexStatus) {
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
async function waitForIndex(): Promise<void> {
  for (;;) {
    let s: IndexStatus;
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

// ---- Live reload for externally-changed files ------------------------------
// The server rescans its source folders on a timer (config "watchIntervalSec")
// so .md files added/edited/removed OUTSIDE the app (a text editor, git, etc)
// are picked up without a restart. Poll the same /api/index/status endpoint
// boot already uses and react when its "generation" counter moves.
/** The last index generation seen; null until the first poll sets the baseline. */
let lastGeneration: number | null = null;
async function pollForChanges(): Promise<void> {
  let s: IndexStatus;
  try {
    const r = await fetch('/api/index/status', { cache: 'no-cache' });
    if (!r.ok) return;
    s = await r.json();
  } catch (e) { return; }
  if (!s || typeof s.generation !== 'number') return;
  if (lastGeneration === null) { lastGeneration = s.generation; return; }   // first sample: just record the baseline
  if (s.generation === lastGeneration) return;
  lastGeneration = s.generation;
  onExternalChange();
}
function startChangeWatcher(): void { setInterval(pollForChanges, 4000); }
/**
 * Refresh the tree/map/current doc after the server reports files changed on
 * disk. Never touches an in-progress edit - an open editor buffer is left
 * alone (just a status note) so unsaved work is never silently discarded.
 */
async function onExternalChange(): Promise<void> {
  invalidateGraphModel();
  invalidateAccess();   // an edit anywhere can change a whole chapter's inherited ACL
  await buildRequirementIndex(null, (state.site && state.site.sources) || []);
  if (app.invalidateTree) app.invalidateTree();   // refetch open levels; keep the reader's expansion
  if (document.body.classList.contains('is-editing')) {
    announce('Files changed on disk. Close the editor to see the latest version.');
  } else if (state.current) {
    state.current._loaded = false;
    try { await loadDoc(state.current); renderDoc(state.current); }
    catch (e) { showError('This document is no longer available.'); }
  }
  await requestMapRebuild();
}

// ---- Shell contract -------------------------------------------------------
// Every element id the app resolves through el(). This list is derived from the
// el('...') call sites across app/js, NOT from index.html - it is the code's side
// of the contract, so a template id that gets renamed or dropped fails HERE, by
// name, instead of surfacing three modules away as "cannot read property of null".
// The two overlay hosts are absent from this list because they are not in the
// template either: overlays.ensureOverlayHosts() creates them at boot. They get
// their own list and their own assertion, run AFTER that call.
const REQUIRED_IDS = [
  'accountBtn', 'brand', 'content', 'covBtn', 'crumbs', 'deleteBtn', 'doc-tree',
  'docSearch', 'drawerClose', 'editBtn', 'footNext', 'footPrev', 'graphBtn',
  'hamburger', 'live', 'newDocBtn', 'scrim', 'searchResults', 'themeBtn',
  'tocList', 'treeList', 'treeSearch'
];
// Created by overlays.ensureOverlayHosts() rather than declared in index.html,
// so they are asserted separately - AFTER that call, not before it.
const REQUIRED_OVERLAY_IDS = ['graphOverlay', 'covOverlay'];
/**
 * Fail fast, and once, if index.html and the code have drifted apart. One error
 * naming every missing id beats discovering them a null dereference at a time.
 */
function assertShellIds(): void {
  const missing = REQUIRED_IDS.filter(id => !el(id));
  if (!missing.length) return;
  const err = new Error('index.html is missing ' + missing.length +
    ' element id(s) the app requires: ' + missing.join(', '));
  err.name = 'ShellTemplateError';   // named so the boot catch below can say WHAT broke
  throw err;
}
/**
 * The same check for the hosts overlays.ts builds. Separate because it can only
 * run after ensureOverlayHosts(), and because a failure here means a different
 * thing: not "the template drifted" but "the host module stopped building them",
 * which is what would silently reintroduce the null dereference this contract
 * exists to remove.
 */
function assertOverlayIds(): void {
  const missing = REQUIRED_OVERLAY_IDS.filter(id => !el(id));
  if (!missing.length) return;
  const err = new Error('overlays.ensureOverlayHosts() did not create: ' + missing.join(', '));
  err.name = 'ShellOverlayError';
  throw err;
}

// ---- Boot -----------------------------------------------------------------
/**
 * Application entry point: wires theme/drawer/search/graph/coverage/authoring,
 * loads site config and the server-backed requirement/test index, renders the
 * initial tree, and resolves the starting route.
 */
async function boot(): Promise<void> {
  // Before anything touches a node: prove the template still has what we ask for.
  assertShellIds();
  // Then create the two overlay hosts, BEFORE any module that asks about them.
  // They are cheap empty divs; the modules that fill them may load much later,
  // or never.
  ensureOverlayHosts();
  assertOverlayIds();
  setupTheme();
  appDrawer = setupDrawer();
  setupDocSearch();
  lazyOverlayButton('graphBtn', async () => (await import('./map-view.js')).setupGraphButton());
  lazyOverlayButton('covBtn', async () => (await import('./coverage-view.js')).setupCoverageView());
  setupEditButtons();
  setupTestRun();

  try {
    state.site = await loadSite();
  } catch (e) {
    return showError('Could not reach the server config. Is serve.py running? (' + e.message + ')');
  }
  mustEl('brand').textContent = state.site.siteTitle || 'Documentation';

  // Accounts. loadAuth() is also what mints this browser's CSRF token, so it has
  // to happen before anything can be saved - and before the index calls below,
  // which the server answers differently depending on who is asking.
  await loadAuth();
  setupAccountButton();
  if (signInRequired()) {
    // BOOT IS SUSPENDED HERE, and that is the point. Nothing below this line -
    // waitForIndex, buildRequirementIndex, the tree mount, route(), the change
    // watcher - runs until there is a real session. Rendering the router behind
    // a reactive `signedIn` flag instead would let all of it fire from a
    // locked-out browser; the server refuses each request, so it is not a leak,
    // but it turns "no request was made" into "a request was made and denied".
    await new Promise(resolve => mountSignInWall(document.body, { onSignedIn: () => resolve(undefined) }));
    await loadAuth();            // the session, and this browser's CSRF token
  }
  document.body.setAttribute('data-auth', auth.enabled ? (auth.user ? 'user' : 'anon') : 'off');

  // Load any opted-in renderer plugins (config "plugins"). Fault-tolerant: a
  // missing plugin or absent library is skipped, never blocking boot.
  await loadPlugins(state.site.plugins || []);   // `plugins` is an optional site.json key

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

  await mountShellIslands();
  setupDrawerSearch();

  window.addEventListener('hashchange', route);
  if (!location.hash || !location.hash.startsWith('#/')) {
    location.replace('#/' + defaultId());
  }
  await route();
  startChangeWatcher();

  document.body.setAttribute('data-app-ready', '1');
}

// Nothing awaits boot(), so until now a rejection anywhere inside it left the page
// at data-app-ready="0" forever with the reason only in the devtools console - the
// exact shape of "one line of JS threw and the whole Playwright suite timed out".
// Report the cause through both channels: showError() puts it on screen for a human,
// #live puts it somewhere a test can read without a console listener.
boot().catch(e => {
  const why = (e && e.name && e.name !== 'Error' ? e.name + ': ' : '') + ((e && e.message) || String(e));
  const msg = 'WebDocs failed to start. ' + why;
  console.error(msg, e);
  // showError() renders into #content - which may itself be the id that is missing,
  // so fall back to the body rather than throwing a second time inside the handler.
  try { showError(msg); } catch (e2) { document.body.appendChild(elem('div', 'doc-error', msg)); }
  announce(msg);   // owns the missing-#live guard this path used to carry inline
  // Not '1' - the ready gate still (correctly) never opens. But a distinct value
  // lets a waiter fail immediately with a reason instead of sitting out its timeout.
  document.body.setAttribute('data-app-ready', 'error');
});
