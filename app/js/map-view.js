// map-view.js - the document-relationship "Map" overlay: fetch the server graph
// model, (re)build the pan/zoom canvas graph, and own the map's open/close plus its
// focus/edit state. Extracted from main.js.
//
// The map and coverage views are both full-screen overlays; only one at a time -
// each registers its close() on the shared `app` registry (app.closeMapView /
// app.closeCoverageView) so the other overlay can dismiss it without a hard import.
// The map likewise reaches the shell + authoring through `app` (app.navigate,
// app.editDocRelation, app.deleteDocFlow), which main.js wires at boot; main imports
// buildDocGraph / ensureGraphModel / invalidateGraphModel directly.
import { elem } from './dom.js';
import { state, el, app } from './app-shell.js';
import { createGraph } from './graph.js';

/**
 * The object createGraph() (graph.js) returns: a plain object literal, not a
 * class instance, exposing the handful of methods/getters this module drives
 * the map through (destroy/focus/fit/search/setCurrent/setEditMode/setConnector/
 * getTransform/getEditState/setStatus/setStatusFilter/getNodePositions).
 * @typedef {Object} GraphContext
 * @property {function(): void} destroy
 * @property {function(string): void} focus
 * @property {function(): void} fit
 * @property {function(string): void} search
 * @property {function(string): void} setCurrent
 * @property {function(boolean): void} setEditMode
 * @property {function(string): void} setConnector
 * @property {function(): {tx: number, ty: number, k: number}} getTransform
 * @property {function(): {editMode: boolean, connector: string}} getEditState
 * @property {function(Object): void} setStatus
 * @property {function(string[]): void} setStatusFilter
 * @property {function(): Map<string, {x: number, y: number}>} getNodePositions
 */

/**
 * Map overlay UI state, persisted across rebuilds on this module-level singleton
 * (survives close/reopen and switching between views).
 * @typedef {Object} DocMapState
 * @property {boolean} editMode
 * @property {string} connector - 'recnext' | 'prereq'; the connection type new edit-mode connections create
 * @property {string} mapMode - which connection type drives the tree layout: 'all' | 'recnext' | 'prereq'
 * @property {{tx: number, ty: number, k: number}|null} transform - last pan/zoom, restored on reopen
 * @property {boolean} focusMode
 * @property {string|null} focusId - radial-focus centre node id
 */

/** @type {GraphContext|null} */
let graphApi = null;
/** @type {HTMLElement|null} */
let docMapStage = null;
/** @type {DocMapState} */
const docMapState = { editMode: false, connector: 'recnext', mapMode: 'all', transform: null, focusMode: false, focusId: null }; // persisted across rebuilds (transform = last pan/zoom; focusId = radial-focus centre)

// The map's data now comes from the server's SQLite index (GET /api/index/graph),
// not from scanning every loaded doc body. Fetched once per open and cached;
// invalidated after an edit/create/delete (which updates the server index).

/**
 * A slimmed-down document reference (id/title/description/assumes/next) produced
 * for every node in this module's GraphModel; authoring.js reuses this same list,
 * unmodified, as the 'all documents' data the editor's Assumed-knowledge/
 * Recommended-next pickers (editor/panels.js's docPicker) render as selectable options.
 * @typedef {Object} GraphDocNode
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string[]} assumes
 * @property {string[]} next
 */

/**
 * The server-backed document graph, fetched once and cached by fetchGraphModel()/
 * ensureGraphModel() from GET /api/index/graph, reshaping the server's compact
 * node/edge-tuple response into named collections. Distinct from the internal
 * `GraphBuildModel` used by the graph/*.js rendering pipeline.
 * @typedef {Object} GraphModel
 * @property {GraphDocNode[]} docs
 * @property {{from: string, to: string}[]} traceEdges
 * @property {{from: string, to: string}[]} pageLinks
 * @property {{id: string, url: string}[]} externalNodes
 */

/** @type {GraphModel|null} */
let graphModel = null;
/** Drop the cached graph model so the next ensureGraphModel() call refetches it. @returns {void} */
export function invalidateGraphModel() { graphModel = null; }
/**
 * Fetch the server's compact graph index (GET /api/index/graph) and reshape it
 * into a {@link GraphModel}; falls back to an empty model on a network/parse error.
 * @returns {Promise<GraphModel>}
 */
async function fetchGraphModel() {
  const empty = { docs: [], traceEdges: [], pageLinks: [], externalNodes: [] };
  let g;
  try { const res = await fetch('/api/index/graph', { cache: 'no-cache' }); if (!res.ok) return empty; g = await res.json(); }
  catch (e) { return empty; }
  const nodes = g.nodes || [];
  // Rebuild the docs[] that buildModel expects (assumes/next drive the hierarchy).
  const docs = nodes.map(n => ({ id: n[0], title: n[1], description: n[2] || '', assumes: [], next: [] }));
  for (const e of g.edges || []) {
    const f = e[0], t = e[1];
    if (f < 0 || t < 0) continue;
    if (e[2] === 0) docs[t].assumes.push(docs[f].id);   // prereq [P,D,0]: D assumes P
    else docs[f].next.push(docs[t].id);                 // recnext [D,S,1]: D.next = S
  }
  const externals = g.externals || [];
  const externalNodes = externals.map(u => ({ id: 'ext:' + u, url: u }));
  const traceEdges = (g.traces || []).filter(e => e[0] >= 0 && e[1] >= 0).map(e => ({ from: nodes[e[0]][0], to: nodes[e[1]][0] }));
  const pageLinks = [];
  for (const e of g.pageLinks || []) {
    const f = e[0]; if (f < 0) continue;
    if (e[2] >= 0) pageLinks.push({ from: nodes[f][0], to: 'ext:' + externals[e[2]] });
    else if (e[1] >= 0) pageLinks.push({ from: nodes[f][0], to: nodes[e[1]][0] });
  }
  return { docs: docs, traceEdges: traceEdges, pageLinks: pageLinks, externalNodes: externalNodes };
}
/**
 * The cached, server-backed graph model: fetched at most once until
 * invalidateGraphModel() clears it (after an edit/create/delete updates the
 * server index).
 * @returns {Promise<GraphModel>}
 */
export async function ensureGraphModel() { if (!graphModel) graphModel = await fetchGraphModel(); return graphModel; }

// (Re)build the document map. `keepView` restores the current pan/zoom (used
// after an edit-connections change so the view doesn't jump). Async: it fetches
// the server graph model (cached) before laying out.
/**
 * @param {boolean} [keepView] - documented as restoring the current pan/zoom on
 *   an edit-connections change, but currently unread in the body below (see notes)
 * @param {boolean} [animate] - animate nodes from their prior positions (tween) into the new layout
 * @param {boolean} [refit] - fit fresh to the new layout frame instead of restoring the saved pan/zoom (used on a focus change)
 * @returns {Promise<void>}
 */
export async function buildDocGraph(keepView, animate, refit) {
  // Fetch the (cached) server graph model BEFORE touching the live graph, so the
  // current map stays on-screen during the await. Destroying first and THEN awaiting
  // left the map blank for a frame -> the "flash" on create/delete/edit rebuilds.
  // With the model in hand, destroy + recreate happen in ONE synchronous step.
  const model = await ensureGraphModel();
  // Restore the map's last pan/zoom (persisted in docMapState.transform) so it
  // survives close/reopen, switching between views, and tree-update rebuilds -
  // EXCEPT on a focus change (refit), where the layout differs enough that we fit
  // fresh to the new radial/hierarchy frame. First-ever open also fits.
  let initialTransform = refit ? undefined : docMapState.transform, animateFrom;
  if (graphApi) {
    const es = graphApi.getEditState(); docMapState.editMode = es.editMode; docMapState.connector = es.connector;
    docMapState.transform = graphApi.getTransform();   // remember the live view
    if (!refit) initialTransform = docMapState.transform;   // ...and restore it on an in-place rebuild
    if (animate && graphApi.getNodePositions) animateFrom = graphApi.getNodePositions();
    graphApi.destroy();
  }
  const focused = !!(docMapState.focusMode && docMapState.focusId);
  // "Map by" mode picks which connection TYPE shapes the tree layout. It never
  // hides edges - every connection is still drawn; the legend toggles own visibility.
  const mode = docMapState.mapMode || 'all';
  const mapModes = [
    { value: 'all', label: 'All connections', swatch: 'all' },
    { value: 'recnext', label: 'Recommended next', swatch: 'recnext' },
    { value: 'prereq', label: 'Prerequisite', swatch: 'prereq' }
  ];
  graphApi = createGraph(docMapStage, model.docs, {
    currentId: focused ? docMapState.focusId : (state.current && state.current.id),
    traceEdges: model.traceEdges,
    pageLinks: model.pageLinks,
    externalNodes: model.externalNodes,
    initialTransform: initialTransform,
    animateFrom: animateFrom,
    mapModes: mapModes,
    mapMode: mode,
    onMapMode: (m) => { docMapState.mapMode = m; buildDocGraph(true, true); },  // relayout + animate the rearrange
    focusMode: docMapState.focusMode,
    focusId: focused ? docMapState.focusId : null,
    onFocusToggle: () => {                           // toggle focus mode; leaving it returns to the hierarchy
      docMapState.focusMode = !docMapState.focusMode;
      if (!docMapState.focusMode) docMapState.focusId = null;
      buildDocGraph(false, true, true);            // re-fit to the new frame
    },
    onSelect: (id) => {                             // focus mode: a click centres the map on the node + its links
      if (docMapState.focusMode) {
        docMapState.focusId = (docMapState.focusId === id) ? null : id;   // re-clicking the centre returns to the hierarchy
        buildDocGraph(false, true, true);
      } else { app.navigate(id); }                  // normal mode: select it, stay on the map
    },
    onActivate: (id) => { if (app.closeMapView) app.closeMapView(); app.navigate(id); }, // dbl-click: open + leave
    onConnect: async (sourceId, targetId, type) => {   // A then B: prereq edge A->B means B assumes A
      const ok = type === 'prereq'
        ? await app.editDocRelation(targetId, sourceId, 'assumes', 'add')   // owned by the dependent doc (B)
        : await app.editDocRelation(sourceId, targetId, 'next', 'add');     // recnext owned by the source doc (A)
      if (ok) buildDocGraph(true, true);
    },
    onDisconnect: async (fromId, toId, type) => {       // remove the drawn edge
      const ok = type === 'prereq'
        ? await app.editDocRelation(toId, fromId, 'assumes', 'remove')   // prereq edge P->D means D assumes P
        : await app.editDocRelation(fromId, toId, 'next', 'remove');     // recnext edge D->S means D.next has S
      if (ok) buildDocGraph(true, true);
    },
    onDelete: (id) => app.deleteDocFlow(id, { rebuildMap: true })   // Delete key on a selected node
    // No in-map "New document" button: the header's ＋ (title "New document") is
    // always available, so a second create button on the map was redundant.
  });
  if (docMapState.editMode) { graphApi.setEditMode(true); graphApi.setConnector(docMapState.connector); }
}

/**
 * Wire the header's Map button: opens/closes the map overlay (building the graph
 * on open), and the Escape key handler that first leaves focus mode before
 * closing the overlay outright.
 * @returns {void}
 */
export function setupGraphButton() {
  const btn = el('graphBtn');
  const stage = elem('div'); // becomes .graph-root, fills overlay
  const overlay = elem('div', { class: 'graph-overlay', id: 'graphOverlay', hidden: true }, stage);
  document.body.appendChild(overlay);
  docMapStage = stage;

  const open = async () => {
    if (app.closeCoverageView) app.closeCoverageView();   // only one overlay view at a time
    overlay.hidden = false;
    btn.setAttribute('aria-pressed', 'true');
    await buildDocGraph(false);
    el('live').textContent = 'Opened the document map. Click a document to select it; double-click to open it. Escape closes.';
  };
  const close = () => {
    if (overlay.hidden) return;
    overlay.hidden = true;
    btn.setAttribute('aria-pressed', 'false');
    docMapState.editMode = false;                 // start fresh next open
    if (graphApi) { docMapState.transform = graphApi.getTransform(); graphApi.destroy(); graphApi = null; }  // remember the view
    el('content').focus({ preventScroll: true });
  };

  app.closeMapView = close;
  btn.addEventListener('click', () => (overlay.hidden ? open() : close()));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || overlay.hidden) return;
    if (docMapState.focusMode && docMapState.focusId) { docMapState.focusId = null; buildDocGraph(false, true, true); }  // Esc: leave the focused node -> hierarchy
    else close();
  });
}
