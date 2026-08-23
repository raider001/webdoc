// graph.ts - the document-relationship "Map" view (entry point).
// ---------------------------------------------------------------------------
// A pannable / zoomable directed graph of documents, rendered on a <canvas> with
// no graph library. This module is the orchestrator: createGraphController builds
// a shared context `g` (transform + edit state, DOM refs, callbacks) and runs the
// pipeline layout -> render -> view -> edit state -> interactions, each in
// ./graph/*:
//   layout.js        pure model + Sugiyama-lite layout math (DOM-free, testable)
//   render.js        build the SVG scene (edges, nodes, external boxes) + sizing
//   view.js          pan/zoom transform, fit, focus, search, minimap
//   chrome.js        the edit-mode state machine (state only - no DOM)
//   interactions.js  pointer/wheel/keyboard wiring, init fit/flash, destroy
//
// THE ENGINE OWNS ONE ELEMENT: the <canvas> it appends to the host it was given.
// It never clears that host and never builds or writes to a control, so it can be
// mounted inside DOM somebody else manages. Chrome is a SUBSCRIBER now: the
// controller reports its edit/visibility state through on('change'), and
// ./graph/chrome-view.js is the vanilla implementation of that contract.
//
// Edge semantics:
//   - an "assumes" entry P on doc D => prerequisite edge  P -> D  (solid, --prereq)
//   - a "next"    entry S on doc D => recommended-next edge D -> S (dashed, --recnext)
// ---------------------------------------------------------------------------
import { buildModel, layoutGraph, focusLayout } from './graph/layout.js';
import { computeNodeSize, positionExternal, renderScene, startTween } from './graph/render.js';
import { attachView } from './graph/view.js';
import { attachEditState } from './graph/chrome.js';
import { mountGraphChrome } from './graph/chrome-view.js';
import { wireInteractions } from './graph/interactions.js';
import { groupColor } from './auth.js';

import type { DocEdgeRef } from './requirements.js';
import type { ExternalLinkNode } from './doclinks.js';
import type { CoverageStatus } from './coverage.js';
import type { GraphBuildModel, ModelGraphNode, GraphLayoutResult } from './graph/layout.js';
import type { TweenItem, GraphColors } from './graph/render.js';

// Re-exported for isolated unit testing of the layout math.
export { buildModel, layoutGraph } from './graph/layout.js';

/**
 * The whole of what the graph needs from a "document" - buildModel reads these
 * fields and nothing else. Deliberately NOT catalog.js's Doc: neither caller has
 * one. The doc map feeds the server index's slim node records (no source/rel/
 * url/name), and the coverage view feeds requirement/test pseudo-docs that were
 * never files at all. Only `id` is load-bearing; every other field defaults.
 */
export interface GraphInputDoc {
  id: string;
  title?: string;
  description?: string;
  /** prerequisite ids: each P yields edge P -> this */
  assumes?: string[];
  /** recommended-next ids: each S yields edge this -> S */
  next?: string[];
  /** access groups that may read it (doc map only) */
  groups?: string[];
  /** visible to this reader but not openable (doc map only) */
  locked?: boolean;
}

/**
 * The options object accepted by createGraphController(): a large config /
 * callback bag mixing doc-map-only features (onDelete/mapModes/focus),
 * coverage-view-only features (nodeStatus/nodeKind/autoSize), and edge data
 * (traceEdges/pageLinks/externalNodes). This file defines/defaults every
 * field; coverage-view.js is one concrete caller building an instance.
 */
export interface GraphOptions {
  currentId?: string | null;
  /** fallback used for onSelect/onActivate when they are not given */
  onOpenDoc?: (id: string) => void;
  /** single click / Enter */
  onSelect?: (id: string) => void;
  /** double click */
  onActivate?: (id: string) => void;
  onConnect?: (from: string, to: string, type: string) => void;
  onDisconnect?: (from: string, to: string, type: string) => void;
  onDelete?: (id: string) => void;
  mapModes?: { value: string, label: string, swatch: string }[];
  mapMode?: string | null;
  onMapMode?: (mode: string) => void;
  /** every access group named in this payload (doc map) */
  accessGroups?: string[];
  /** groups toggled off in the group legend */
  hiddenGroups?: Set<string>;
  focusMode?: boolean;
  focusId?: string | null;
  onFocusToggle?: () => void;
  traceEdges?: DocEdgeRef[];
  pageLinks?: DocEdgeRef[];
  externalNodes?: ExternalLinkNode[];
  /** mutable via setStatus */
  nodeStatus?: Map<string, CoverageStatus> | Record<string, CoverageStatus> | null;
  /** id -> 'req' | 'test' (coverage view) */
  nodeKind?: Map<string, string> | Record<string, string> | null;
  autoSize?: boolean;
  maxNodeW?: number;
  maxNodeH?: number;
  /** chrome-view.js only; the engine has no legend to hide */
  hideLegend?: boolean;
  /**
   * The surface to paint the minimap on. The engine draws it and handles clicks
   * on it, but never creates it: the frame around it is chrome.
   */
  minimapCanvas?: HTMLCanvasElement | null;
  initialTransform?: { tx: number, ty: number, k: number } | null;
  animateFrom?: Map<string, { x: number, y: number }> | null;
}

/**
 * A positioned box in world space. Both a laid-out document node and an
 * external-link box resolve to this shape, which is why g.nodePos can return
 * either without the callers caring which they got.
 *
 * cx/cy are the tell between the two: a laid-out doc node always carries its
 * centre, an external box never does (positionExternal only ever sets x/y/w/h),
 * which is why code that wants a centre tests `cx != null` and falls back to
 * x + w/2 rather than branching on where the box came from.
 */
export interface GraphBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** laid-out doc nodes only */
  cx?: number;
  /** laid-out doc nodes only */
  cy?: number;
}

/**
 * One precomputed edge in the draw list: its world polyline, bounding box and
 * category, built once per layout by render.js so the draw loop never
 * recomputes geometry.
 */
export interface GraphEdgeItem {
  from: string;
  to: string;
  type: string;
  /** the visibility key looked up in g.vis */
  cat: string;
  pts: { x: number, y: number }[];
  /**
   * [minx, miny, maxx, maxy]; an array, not an object, because the cull test
   * indexes it per edge per frame
   */
  aabb: [number, number, number, number];
  /** which end carries the arrowhead, 'start' or 'end' */
  head: string;
}

/**
 * `g` - the shared mutable context created by createGraph() and threaded through
 * the whole pipeline. Every stage attaches its own fields to the same object, so
 * the context type is the intersection of what each stage contributes, and the
 * five stage interfaces below mirror the modules in ./graph/ one for one.
 *
 * Keep them in sync when a stage grows a field. This used to be a partial list
 * that openly admitted it was partial, which meant 85 of the 105 fields were
 * undeclared - and an undeclared field on a typed object is not an error at the
 * assignment, it is a silent `any` at every read site downstream.
 */
export type GraphContext = GraphCoreCtx & GraphRenderCtx & GraphViewCtx & GraphEditCtx & GraphInteractionCtx;

/**
 * Stage 1, this file: config, callbacks, edge data and the live transform.
 */
export interface GraphCoreCtx {
  container: HTMLElement;
  opts: GraphOptions;
  model: GraphBuildModel;
  nodeList: ModelGraphNode[];
  /** deterministic search order */
  sortedIds: string[];
  layout: GraphLayoutResult;
  currentId: string | null;
  /** single click / Enter */
  onSelect: (id: string) => void;
  /** double click */
  onActivate: (id: string) => void;
  traceEdges: DocEdgeRef[];
  pageLinks: DocEdgeRef[];
  externalNodes: ExternalLinkNode[];
  /** mutable via setStatus */
  nodeStatus: Map<string, CoverageStatus> | Record<string, CoverageStatus> | null;
  statusOf: (id: string) => (CoverageStatus | null);
  kindOf: (id: string) => (string | null);
  onConnect: ((from: string, to: string, type: string) => void) | null;
  onDisconnect: ((from: string, to: string, type: string) => void) | null;
  /** true when either connect callback was supplied */
  editable: boolean;
  onDelete: ((id: string) => void) | null;
  mapMode: string | null;
  onMapMode: ((mode: string) => void) | null;
  hiddenGroups: Set<string>;
  groupColor: (name: string) => string;
  focusId: string | null;
  /** subscribers, by event name */
  listeners: { change: ((e: GraphChangeEvent) => void)[] };
  /** snapshot the reportable state and hand it to every subscriber */
  emitChange: () => void;
  /** live transform: world -> screen translate x */
  tx: number;
  ty: number;
  /** scale */
  k: number;
  /** lowered by fit() so a fitted whole-graph view can zoom back out */
  minK: number;
  editMode: boolean;
  activeConnector: string;
  pendingSource: string | null;
  selectedEdge: { from: string, to: string, type: string } | null;
  flashTimer: number | null;
  ro: ResizeObserver | null;
  fitted: boolean;
}

/**
 * Stage 2, ./graph/render.js: the canvas surface, the draw loop and the spatial
 * indexes the loop and hit-testing read.
 */
export interface GraphRenderCtx {
  canvas: HTMLCanvasElement;
  /** the same canvas; view.js/interactions.js address the surface under this name */
  svgEl: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dpr: number;
  cssW: number;
  cssH: number;
  /** re-read from CSS custom properties on theme change */
  colors: GraphColors;
  /** per-edge-category visibility, keyed by GraphEdgeItem.cat */
  vis: Record<string, boolean>;
  hiddenStatuses: Set<string>;
  /** external-link boxes by id */
  extPos: Map<string, GraphBox>;
  /** resolves a doc node or an external box */
  nodePos: (id: string) => (GraphBox | null);
  hoverId: string | null;
  flashId: string | null;
  flashUntil: number;
  tween: { items: TweenItem[], start: number, dur: number } | null;
  /**
   * per-node DELTA from the tweened-from position, not a position; nulled when
   * the tween ends
   */
  tweenOffset: Map<string, { dx: number, dy: number }> | null;
  dirty: boolean;
  running: boolean;
  rafPending: boolean;
  rafId: number;
  resize: () => void;
  requestDraw: () => void;
  drawStop: () => void;
  /** synchronous full frame (perf harness / tests) */
  drawNow: () => void;
  themeObs: MutationObserver;
  /** uniform spatial index for hit-testing */
  grid: { cell: number, map: Map<string, string[]> };
  nodeAtWorld: (wx: number, wy: number) => (string | null);
  /**
   * A bare edge ref, matching selectedEdge; the hit item itself is never handed
   * out.
   */
  edgeAtWorld: (wx: number, wy: number, tol?: number) => ({ from: string, to: string, type: string } | null);
  edgeItems: GraphEdgeItem[];
  /**
   * INDEXES into edgeItems, so an edge touching two visible nodes is
   * de-duplicated by index rather than by object identity
   */
  edgesByNode: Map<string, number[]>;
}

/**
 * Stage 3, ./graph/view.js: transform maths, framing, search and the minimap.
 */
export interface GraphViewCtx {
  viewSize: () => { w: number, h: number, rect: DOMRect };
  applyTransform: () => void;
  fit: () => void;
  zoomAround: (px: number, py: number, factor: number) => void;
  zoomCenter: (factor: number) => void;
  flash: (id: string) => void;
  focus: (id: string) => boolean;
  setCurrent: (id: string) => void;
  search: (query: string) => (string | null);
  buildMinimap: () => void;
  updateMinimap: () => void;
  miniScale: number;
  miniOX: number;
  miniOY: number;
  /** offscreen minimap cache, created lazily */
  miniCache?: HTMLCanvasElement;
  /** opts.minimapCanvas, or null for no minimap */
  miniCanvas: HTMLCanvasElement | null;
  miniCtx: CanvasRenderingContext2D | null;
}

/**
 * Stage 4, ./graph/chrome.js: the edit-mode state machine. No DOM: every one of
 * these mutates draw state and then reports through g.emitChange().
 */
export interface GraphEditCtx {
  setConnector: (type: string) => void;
  setEditMode: (on: boolean) => void;
  markSource: (id: string) => void;
  clearPending: () => void;
  clearSelectedEdge: () => void;
  selectEdge: (from: string, to: string, type: string) => void;
}

/**
 * Stage 5, ./graph/interactions.js: teardown. Pointer, wheel and keyboard
 * listeners are closed over rather than attached to the context.
 */
export interface GraphInteractionCtx {
  destroy: () => void;
}

/**
 * One node's world-space box as nodePositions() reports it - a GraphBox with the
 * centre promised, since it only ever describes laid-out doc nodes.
 */
export interface GraphTestBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

/**
 * The hit-test hook parked on `window.__graph`. The map is one <canvas> with no
 * per-node DOM, so an e2e driver has nothing to query for; this is how it turns
 * a document id into screen pixels and back. Coordinates crossing this boundary
 * are CLIENT (viewport) pixels, not world units.
 */
export interface GraphTestApi {
  nodeAt: (clientX: number, clientY: number) => (string | null);
  /** alias of nodeAt */
  hitTest: (clientX: number, clientY: number) => (string | null);
  /** world space */
  nodePositions: () => Record<string, GraphTestBox>;
  /** client pixels */
  center: (id: string) => ({ x: number, y: number } | null);
  transform: () => { tx: number, ty: number, k: number };
  setTransform: (t: { tx?: number, ty?: number, k?: number }) => void;
  redraw: () => void;
  count: () => number;
}

/**
 * What the controller REPORTS. One immutable snapshot of everything a chrome
 * implementation could need in order to draw itself, handed to every on('change')
 * subscriber and returned verbatim by getEditState().
 *
 * `pendingSourceTitle`, not `pendingSource`: the only thing a hint or a label
 * ever did with the pending id was look its title up in the model, and handing
 * out an id would push a model lookup - and therefore the model - across a
 * boundary that exists precisely to keep it in here.
 *
 * `visibility` and `hiddenGroups` are copies. A subscriber that mutated the live
 * g.vis would change what the renderer draws without anything asking for a
 * repaint, which is the exact class of bug this inversion is meant to end.
 */
export interface GraphChangeEvent {
  editMode: boolean;
  /** the armed connection type, 'prereq' | 'recnext' */
  connector: string;
  /** first node of a half-finished connect gesture */
  pendingSourceTitle: string | null;
  selectedEdge: { from: string, to: string, type: string } | null;
  /** per-edge-category, keyed by GraphEdgeItem.cat */
  visibility: Record<string, boolean>;
  hiddenGroups: Set<string>;
}

/**
 * The controller: everything the outside world may do to a live graph.
 *
 * Deliberately small and deliberately one-way. Commands go in as method calls,
 * state comes back as change events, and nothing in here hands out the context,
 * the model, an element or a listener. Anything a caller cannot express through
 * this surface is a rebuild - build a new controller and destroy the old one,
 * which is what a re-layout has always been.
 */
export interface GraphController {
  destroy: () => void;
  fit: () => void;
  focus: (id: string) => boolean;
  search: (query: string) => (string | null);
  setCurrent: (id: string) => void;
  setEditMode: (on: boolean) => void;
  setConnector: (type: string) => void;
  setMapMode: (mode: string) => void;
  setVisibility: (cat: string, on: boolean) => void;
  setHiddenGroups: (names: Iterable<string>) => void;
  setStatus: (m: Map<string, CoverageStatus> | Record<string, CoverageStatus>) => void;
  setStatusFilter: (hidden: Iterable<string>) => void;
  zoomBy: (factor: number) => void;
  getTransform: () => { tx: number, ty: number, k: number };
  getEditState: () => GraphChangeEvent;
  getNodePositions: () => Map<string, { x: number, y: number }>;
  on: (evt: string, cb: (e: GraphChangeEvent) => void) => (() => void);
}

/**
 * Snapshot the reportable state. Built fresh on every emit rather than mutated,
 * so a subscriber can keep the object it was handed.
 */
function changeEvent(g: GraphContext): GraphChangeEvent {
  const src = g.pendingSource ? g.model.nodes.get(g.pendingSource) : null;
  const se = g.selectedEdge;
  return {
    editMode: g.editMode,
    connector: g.activeConnector,
    pendingSourceTitle: g.pendingSource ? ((src && src.title) || g.pendingSource) : null,
    selectedEdge: se ? { from: se.from, to: se.to, type: se.type } : null,
    visibility: Object.assign({}, g.vis),
    hiddenGroups: new Set(g.hiddenGroups)
  };
}

/**
 * Build the pannable/zoomable document-relationship graph for `docs` and wire up
 * its pipeline (model -> layout -> render -> view -> edit state -> interactions).
 *
 * `canvasEl` is the element the engine paints in: it appends ONE <canvas> to it,
 * sizes itself to it, observes it for resizes, and on destroy removes exactly
 * that canvas again. It is never cleared, so it may already hold - or later be
 * given - DOM this engine did not create. Two `container.textContent = ''` calls
 * used to say otherwise, and either of them would have deleted a live chrome
 * component's nodes out from under it.
 * @param canvasEl - the element the engine's <canvas> lives in
 */
export function createGraphController(canvasEl: HTMLElement, docs: GraphInputDoc[], options?: GraphOptions): GraphController {
  const opts = options || {};
  // `g` is only a whole GraphContext once every stage below has attached its own
  // fields, so it is declared as one up front rather than accumulating an
  // inferred shape that each stage would then have to be trusted to widen.
  const g = { container: canvasEl, opts: opts } as GraphContext;

  // --- config / callbacks ---
  g.currentId = opts.currentId || null;
  const onOpenDoc = typeof opts.onOpenDoc === 'function' ? opts.onOpenDoc : function () {};
  g.onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : onOpenDoc;       // single click / Enter
  g.onActivate = typeof opts.onActivate === 'function' ? opts.onActivate : onOpenDoc; // double click
  g.traceEdges = Array.isArray(opts.traceEdges) ? opts.traceEdges : [];
  g.pageLinks = Array.isArray(opts.pageLinks) ? opts.pageLinks : [];
  g.externalNodes = Array.isArray(opts.externalNodes) ? opts.externalNodes : [];
  // Both lookups accept a Map OR a plain object, so `.get` doubles as the probe
  // for which one arrived; the cast just tells the checker what that probe proved.
  g.nodeStatus = opts.nodeStatus || null; // Map/obj id -> {status, pct} for the coverage view (mutable via setStatus)
  g.statusOf = (id: string) => g.nodeStatus ? (g.nodeStatus.get ? (g.nodeStatus as Map<string, CoverageStatus>).get(id) : (g.nodeStatus as Record<string, CoverageStatus>)[id]) : null;
  const nodeKind = opts.nodeKind || null;     // Map/obj id -> 'req' | 'test' (coverage view)
  g.kindOf = (id: string) => nodeKind ? (nodeKind.get ? (nodeKind as Map<string, string>).get(id) : (nodeKind as Record<string, string>)[id]) : null;
  // Edit-connections mode (enabled when connect/disconnect callbacks are given).
  g.onConnect = typeof opts.onConnect === 'function' ? opts.onConnect : null;
  g.onDisconnect = typeof opts.onDisconnect === 'function' ? opts.onDisconnect : null;
  g.editable = !!(g.onConnect || g.onDisconnect);
  // CRUD hook (doc map only): delete the selected document (Delete key). The app
  // performs the side-effect.
  g.onDelete = typeof opts.onDelete === 'function' ? opts.onDelete : null;
  // "Map by": which connection type drives the layout. The LIST of offered modes
  // is chrome's business, not the engine's - all the engine needs is the one that
  // is active, plus somewhere to send a request for a different one.
  g.mapMode = opts.mapMode || null;
  g.onMapMode = typeof opts.onMapMode === 'function' ? opts.onMapMode : null;
  // Access groups: which groups are dimmed, and the colour function. Purely
  // visual - the server already decided what is in this payload at all. The list
  // of every group in the payload (opts.accessGroups) is the legend's, not ours.
  g.hiddenGroups = opts.hiddenGroups instanceof Set ? new Set(opts.hiddenGroups) : new Set();
  g.groupColor = groupColor;
  // Focus mode (doc map): when a node is focused, the map is laid out radially
  // around it (its links ringed like sun-rays, every other node pushed far out).
  // Toggling the MODE re-lays-out, so it is a rebuild, not a method: the engine
  // only ever sees which node - if any - this instance was built around.
  g.focusId = opts.focusId || null;

  // --- mutable state ---
  g.tx = 0; g.ty = 0; g.k = 1;                       // live transform
  g.miniScale = 1; g.miniOX = 0; g.miniOY = 0;
  g.editMode = false; g.activeConnector = 'recnext';
  g.pendingSource = null; g.selectedEdge = null;
  g.flashTimer = null; g.ro = null; g.fitted = false;
  // The minimap SURFACE comes from outside; the frame around it is chrome. view.js
  // and interactions.js both already treat a missing one as "no minimap".
  g.miniCanvas = opts.minimapCanvas || null;
  g.miniCtx = g.miniCanvas ? g.miniCanvas.getContext('2d') : null;

  // --- the outward report ---
  g.listeners = { change: [] };
  g.emitChange = function () {
    if (!g.listeners.change.length) return;
    const ev = changeEvent(g);
    // Iterate a copy: a subscriber is allowed to unsubscribe from inside its own
    // callback, and splicing the live array mid-loop would skip its neighbour.
    for (const cb of g.listeners.change.slice()) {
      try { cb(ev); } catch (err) { /* one bad subscriber must not stop the rest */ }
    }
  };

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
    const nb = new Set<string>();
    const rel = (a: string, b: string) => { if (a === g.focusId) nb.add(b); else if (b === g.focusId) nb.add(a); };
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
  renderScene(g);        // g.canvas / g.svgEl / g.vis + all drawing
  attachView(g);         // g.applyTransform, fit, zoom, focus, setCurrent, search, minimap
  attachEditState(g);    // g.setConnector / markSource / selectEdge / setEditMode - state, no DOM
  wireInteractions(g);   // pointer/wheel/keyboard + init fit/flash + g.destroy

  // Fancy re-layout: given the previous node positions, tween each node from where
  // it was to where it landed (mode switch / edit rebuild re-arranges live).
  if (opts.animateFrom instanceof Map && opts.animateFrom.size) animateRelayout(g, opts.animateFrom);

  // Test/automation hook: canvas has no per-node DOM for e2e (pytest-playwright) to
  // click, so expose a hit-test + positions. `nodeAt` takes CLIENT (screen) pixels.
  //
  // ONE OWNER, AND IT IS THIS CONTROLLER. Every createGraph call used to assign
  // this and no destroy ever cleared it, so the coverage view's instance quietly
  // overwrote the map's and a destroyed graph stayed reachable through it - which
  // is exactly what an intermittent failure in tests/test_map_ui.py turned out to
  // be. Installing here and clearing in destroy() below makes the hook mean "the
  // live graph", which is the only thing a driver can safely assume it means.
  // `__graph` is ours, not the DOM's, so both the install and hitTest's read-back
  // go through one alias that says so.
  const testWindow = window as unknown as (typeof window & { __graph: GraphTestApi | null });
  const hook: GraphTestApi = {
    nodeAt: function (clientX, clientY) { const r = g.svgEl.getBoundingClientRect(); return g.nodeAtWorld((clientX - r.left - g.tx) / g.k, (clientY - r.top - g.ty) / g.k); },
    hitTest: function (clientX, clientY) { return hook.nodeAt(clientX, clientY); },
    nodePositions: function () {
      const m: Record<string, GraphTestBox> = {};
      g.layout.nodes.forEach((n, id) => { m[id] = { x: n.x, y: n.y, w: n.w, h: n.h, cx: n.cx, cy: n.cy }; });
      return m;
    },
    center: function (id) { const r = g.svgEl.getBoundingClientRect(); const n = g.layout.nodes.get(id) || (g.extPos && g.extPos.get(id)); return n ? { x: r.left + (n.cx != null ? n.cx : n.x + n.w / 2) * g.k + g.tx, y: r.top + (n.cy != null ? n.cy : n.y + n.h / 2) * g.k + g.ty } : null; },
    transform: function () { return { tx: g.tx, ty: g.ty, k: g.k }; },
    setTransform: function (t) { if (t) { if (isFinite(t.tx)) g.tx = t.tx; if (isFinite(t.ty)) g.ty = t.ty; if (isFinite(t.k)) g.k = t.k; g.applyTransform(); } },
    redraw: function () { if (g.drawNow) g.drawNow(); },
    count: function () { return g.model.nodes.size; }
  };
  testWindow.__graph = hook;

  return {
    destroy: function () {
      g.destroy();                       // listeners, observers, rAF loop, and the <canvas>
      g.listeners.change.length = 0;
      // Identity-checked: if another controller has since installed its own hook,
      // this one's teardown must not blank it. (The map and the coverage view are
      // both full-screen overlays and each closes the other, but the ORDER of
      // close-then-open is the app's business, not something to depend on here.)
      if (testWindow.__graph === hook) testWindow.__graph = null;
    },
    fit: function () { g.fit(); },
    focus: function (id) { return g.focus(id); },
    search: function (query) { return g.search(query); },
    setCurrent: function (id) { g.setCurrent(id); },
    setEditMode: function (on) { g.setEditMode(on); },
    setConnector: function (type) { g.setConnector(type); },
    // A different map mode is a different LAYOUT, which this instance cannot
    // become - so the request goes back to the app, which rebuilds. Recording it
    // here first keeps getEditState-style reads consistent for the tick in between.
    setMapMode: function (mode) {
      if (!mode || mode === g.mapMode) return;
      g.mapMode = mode;
      if (g.onMapMode) g.onMapMode(mode);
    },
    /**
     * Show or hide one edge category. Draw state, so a repaint plus a report -
     * the legend entry that asked for it learns the outcome the same way any
     * other subscriber does.
     */
    setVisibility: function (cat, on) {
      if (!(cat in g.vis) || g.vis[cat] === !!on) return;
      g.vis[cat] = !!on;
      g.requestDraw();
      g.emitChange();
    },
    setHiddenGroups: function (names) {
      g.hiddenGroups = new Set(names || []);
      g.requestDraw();
      g.emitChange();
    },
    // Coverage view: swap the whole status map (recolor) / hide statuses (legend filter).
    setStatus: function (m) { g.nodeStatus = m; g.requestDraw(); },
    setStatusFilter: function (hidden) { g.hiddenStatuses = new Set(hidden || []); g.requestDraw(); },
    zoomBy: function (factor) { g.zoomCenter(factor); },
    getTransform: function () { return { tx: g.tx, ty: g.ty, k: g.k }; },
    getEditState: function () { return changeEvent(g); },
    // World-space position of every node (for animating the next re-layout).
    getNodePositions: function () {
      const m = new Map<string, { x: number, y: number }>();
      g.layout.nodes.forEach((n, id) => m.set(id, { x: n.x, y: n.y }));
      if (g.extPos) g.extPos.forEach((p, id) => m.set(id, { x: p.x, y: p.y }));
      return m;
    },
    /**
     * Subscribe to 'change'. Returns the unsubscribe, which is the only way off
     * the list - there is no off(), because a token you have to keep is harder to
     * lose than a callback identity you have to reproduce.
     */
    on: function (evt, cb) {
      const list = evt === 'change' ? g.listeners.change : null;
      if (!list || typeof cb !== 'function') return function () {};
      list.push(cb);
      return function () { const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1); };
    }
  };
}

/**
 * The engine plus this repo's standard vanilla chrome, composed into `container`.
 *
 * Kept because two callers still want exactly that pairing: map-view.js and, one
 * dynamic import away, the coverage view's `use:graph` action. Both hand over a
 * whole stage element and expect a map with zoom controls, a search box and a
 * minimap in it. It is a composition, not a layer: it adds no behaviour of its
 * own, and everything it returns is the controller's.
 * @param container - a stage element the graph and its chrome may fill
 */
export function createGraph(container: HTMLElement, docs: GraphInputDoc[], options?: GraphOptions): GraphController {
  const opts = options || {};
  // Chrome is BUILT first (it adds .graph-root, which is what gives the stage its
  // height - and the engine measures that height while fitting) but APPENDED last,
  // by connect(), so the canvas keeps its place at the front of the container.
  const chrome = mountGraphChrome(container, opts);
  const ctl = createGraphController(container, docs,
    Object.assign({}, opts, { minimapCanvas: chrome.minimapCanvas }));
  chrome.connect(ctl);

  return {
    // Teardown in reverse: unsubscribe and remove the chrome first, so nothing
    // can render from a controller that is halfway through being destroyed.
    destroy: function () { chrome.destroy(); ctl.destroy(); },
    fit: ctl.fit,
    focus: ctl.focus,
    search: ctl.search,
    setCurrent: ctl.setCurrent,
    setEditMode: ctl.setEditMode,
    setConnector: ctl.setConnector,
    setMapMode: ctl.setMapMode,
    setVisibility: ctl.setVisibility,
    setHiddenGroups: ctl.setHiddenGroups,
    setStatus: ctl.setStatus,
    setStatusFilter: ctl.setStatusFilter,
    zoomBy: ctl.zoomBy,
    getTransform: ctl.getTransform,
    getEditState: ctl.getEditState,
    getNodePositions: ctl.getNodePositions,
    on: ctl.on
  };
}

// Relayout animation: on canvas there are no per-node DOM transitions, so hand the
// previous positions to the renderer's time-based tween (interpolated in the rAF
// draw loop; see startTween in graph/render.js).
/**
 * @param from - previous world position per node/external-node id
 */
function animateRelayout(g: GraphContext, from: Map<string, { x: number, y: number }>): void { startTween(g, from); }
