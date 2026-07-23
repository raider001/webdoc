// graph.js - the document-relationship "Map" view (entry point).
// ---------------------------------------------------------------------------
// A pannable / zoomable directed graph of documents, rendered as inline SVG with
// no graph library. This module is the orchestrator: createGraph builds a shared
// context `g` (transform + edit state, DOM refs, callbacks) and runs the pipeline
// layout -> render -> view -> chrome -> interactions, each in ./graph/*:
//   layout.js        pure model + Sugiyama-lite layout math (DOM-free, testable)
//   render.js        build the SVG scene (edges, nodes, external boxes) + sizing
//   view.js          pan/zoom transform, fit, focus, search, minimap
//   chrome.js        overlay controls/legend/search/minimap + edit-mode machine
//   interactions.js  pointer/wheel/keyboard wiring, init fit/flash, destroy
//
// Edge semantics:
//   - an "assumes" entry P on doc D => prerequisite edge  P -> D  (solid, --prereq)
//   - a "next"    entry S on doc D => recommended-next edge D -> S (dashed, --recnext)
// ---------------------------------------------------------------------------
import { buildModel, layoutGraph, focusLayout } from './graph/layout.js';
import { computeNodeSize, positionExternal, renderScene } from './graph/render.js';
import { attachView } from './graph/view.js';
import { buildChrome } from './graph/chrome.js';
import { wireInteractions } from './graph/interactions.js';

// Re-exported for isolated unit testing of the layout math.
export { buildModel, layoutGraph } from './graph/layout.js';

// createGraph(container, docs, options)
//   docs: [{ id, source, title, description, assumes:[id...], next:[id...] }]
//   options: { currentId, onOpenDoc, onSelect, onActivate, onConnect, onDisconnect,
//              onDelete, onCreate, focusMode, focusId, onFocusToggle, traceEdges,
//              pageLinks, externalNodes, nodeStatus, nodeKind, autoSize, maxNodeW,
//              maxNodeH, hideLegend, initialTransform }
// Returns { destroy, focus, fit, search, setCurrent, setEditMode, setConnector,
//           getTransform, getEditState }.
export function createGraph(container, docs, options) {
  const opts = options || {};
  const g = { container: container, opts: opts };

  // --- config / callbacks ---
  g.currentId = opts.currentId || null;
  const onOpenDoc = typeof opts.onOpenDoc === 'function' ? opts.onOpenDoc : function () {};
  g.onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : onOpenDoc;       // single click / Enter
  g.onActivate = typeof opts.onActivate === 'function' ? opts.onActivate : onOpenDoc; // double click
  g.traceEdges = Array.isArray(opts.traceEdges) ? opts.traceEdges : [];
  g.pageLinks = Array.isArray(opts.pageLinks) ? opts.pageLinks : [];
  g.externalNodes = Array.isArray(opts.externalNodes) ? opts.externalNodes : [];
  const nodeStatus = opts.nodeStatus || null; // Map/obj id -> {status, pct} for the coverage view
  g.statusOf = (id) => nodeStatus ? (nodeStatus.get ? nodeStatus.get(id) : nodeStatus[id]) : null;
  const nodeKind = opts.nodeKind || null;     // Map/obj id -> 'req' | 'test' (coverage view)
  g.kindOf = (id) => nodeKind ? (nodeKind.get ? nodeKind.get(id) : nodeKind[id]) : null;
  // Edit-connections mode (enabled when connect/disconnect callbacks are given).
  g.onConnect = typeof opts.onConnect === 'function' ? opts.onConnect : null;
  g.onDisconnect = typeof opts.onDisconnect === 'function' ? opts.onDisconnect : null;
  g.editable = !!(g.onConnect || g.onDisconnect);
  // CRUD hooks (doc map only): delete the selected document (Delete key) and
  // create a new one (New-document button). The app performs the side-effects.
  g.onDelete = typeof opts.onDelete === 'function' ? opts.onDelete : null;
  g.onCreate = typeof opts.onCreate === 'function' ? opts.onCreate : null;
  // "Map by" dropdown: pick which connection type drives the layout (doc map).
  g.mapModes = Array.isArray(opts.mapModes) ? opts.mapModes : null;
  g.mapMode = opts.mapMode || (g.mapModes && g.mapModes[0] && g.mapModes[0].value) || null;
  g.onMapMode = typeof opts.onMapMode === 'function' ? opts.onMapMode : null;
  // Focus mode (doc map): when a node is focused, the map is laid out radially
  // around it (its links ringed like sun-rays, every other node pushed far out).
  // onFocusToggle flips the mode; the app sets focusId when a node is clicked.
  g.focusMode = !!opts.focusMode;
  g.focusId = opts.focusId || null;
  g.onFocusToggle = typeof opts.onFocusToggle === 'function' ? opts.onFocusToggle : null;

  // --- mutable state ---
  g.tx = 0; g.ty = 0; g.k = 1;                       // live transform
  g.miniScale = 1; g.miniOX = 0; g.miniOY = 0;
  g.editMode = false; g.activeConnector = 'recnext';
  g.pendingSource = null; g.selectedEdge = null;
  g.editEdgeEls = new Map();                         // 'from|type|to' -> visible edge path
  g.flashTimer = null; g.ro = null; g.fitted = false;

  container.classList.add('graph-root');
  container.textContent = '';

  // --- pipeline ---
  g.model = buildModel(docs || []);
  g.nodeList = Array.from(g.model.nodes.values());
  g.sortedIds = Array.from(g.model.nodes.keys()).sort();  // deterministic search order
  const sizeOverride = opts.autoSize ? computeNodeSize(g) : null;
  const layoutOpts = Object.assign({}, sizeOverride || {}, { layoutMode: g.mapMode || 'all' });
  if (g.focusId && g.model.nodes.has(g.focusId)) {
    // The ring = every DOC node directly linked to the focus by ANY edge type:
    // prereq/recnext + requirement-trace + doc page links. In focus view only the
    // edges that TOUCH the focused node stay visible (see render.js edgeShown).
    const nb = new Set();
    const rel = (a, b) => { if (a === g.focusId) nb.add(b); else if (b === g.focusId) nb.add(a); };
    for (const e of g.model.edges) rel(e.from, e.to);
    for (const te of g.traceEdges) rel(te.from, te.to);
    for (const pl of g.pageLinks) { if (String(pl.to).indexOf('ext:') !== 0) rel(pl.from, pl.to); }
    nb.delete(g.focusId);
    g.layout = focusLayout(g.nodeList, g.model.edges, g.focusId, nb, layoutOpts);
  } else {
    g.focusId = null;   // absent / not a real node -> hierarchy
    g.layout = layoutGraph(g.nodeList, g.model.edges, layoutOpts);
  }
  positionExternal(g);   // g.extPos, g.nodePos (+ extends layout bounds)
  renderScene(g);        // g.svgEl / viewport / edgesG / nodesG + all drawing
  attachView(g);         // g.applyTransform, fit, zoom, focus, setCurrent, search, minimap
  buildChrome(g);        // controls/legend/search/minimap DOM + edit-mode machine
  wireInteractions(g);   // pointer/wheel/keyboard + init fit/flash + g.destroy

  // Fancy re-layout: given the previous node positions, FLIP-animate each node from
  // where it was to where it landed (mode switch / edit rebuild re-arranges live).
  if (opts.animateFrom instanceof Map && opts.animateFrom.size) animateRelayout(g, opts.animateFrom);

  return {
    destroy: g.destroy, focus: g.focus, fit: g.fit, search: g.search, setCurrent: g.setCurrent,
    setEditMode: g.setEditMode, setConnector: g.setConnector,
    getTransform: function () { return { tx: g.tx, ty: g.ty, k: g.k }; },
    getEditState: function () { return { editMode: g.editMode, connector: g.activeConnector }; },
    // World-space position of every node (for animating the next re-layout).
    getNodePositions: function () {
      const m = new Map();
      g.layout.nodes.forEach((n, id) => m.set(id, { x: n.x, y: n.y }));
      if (g.extPos) g.extPos.forEach((p, id) => m.set(id, { x: p.x, y: p.y }));
      return m;
    }
  };
}

// FLIP: each node's transform ATTRIBUTE is already its final spot; we override with
// a CSS transform back to the OLD spot, force a reflow to commit it, then set the
// NEW spot WITH a transition so it slides in. Done synchronously (no rAF, which is
// paused when the pane isn't compositing) and a setTimeout always clears the inline
// styles afterwards, so nodes never get stuck at the old position. Edges (a
// different set each layout) stay hidden while the nodes move and fade in only
// once they've settled.
function animateRelayout(g, from) {
  const dur = 650;
  const pairs = [];
  g.nodesG.querySelectorAll('.graph-node[data-node-id]').forEach(el => {
    const id = el.getAttribute('data-node-id');
    const o = from.get(id), n = g.layout.nodes.get(id) || (g.extPos && g.extPos.get(id));
    if (o && n && (Math.abs(o.x - n.x) > 0.5 || Math.abs(o.y - n.y) > 0.5)) pairs.push({ el, o, n });
  });
  if (!pairs.length) return;
  for (const p of pairs) { p.el.style.transition = 'none'; p.el.style.transform = 'translate(' + p.o.x + 'px,' + p.o.y + 'px)'; }
  g.edgesG.style.transition = 'none'; g.edgesG.style.opacity = '0';
  void g.svgEl.getBoundingClientRect();          // commit the "old position" as the transition start
  for (const p of pairs) { p.el.style.transition = 'transform ' + dur + 'ms cubic-bezier(.4,0,.2,1)'; p.el.style.transform = 'translate(' + p.n.x + 'px,' + p.n.y + 'px)'; }
  // Fade the edges (lines) back in ONLY after the nodes have finished moving, so a
  // line never stretches between a settled node and one still travelling.
  const edgeFade = 260;
  setTimeout(() => { g.edgesG.style.transition = 'opacity ' + edgeFade + 'ms ease'; g.edgesG.style.opacity = '1'; }, dur);
  setTimeout(() => {
    for (const p of pairs) { p.el.style.transition = ''; p.el.style.transform = ''; }
    g.edgesG.style.transition = ''; g.edgesG.style.opacity = '';
  }, dur + edgeFade + 120);
}
