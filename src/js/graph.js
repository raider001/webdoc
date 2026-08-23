// graph.js - the document-relationship "Map" view (entry point).
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

// Re-exported for isolated unit testing of the layout math.
export { buildModel, layoutGraph } from './graph/layout.js';

/** @typedef {import('./requirements.js').DocEdgeRef} DocEdgeRef */
/** @typedef {import('./doclinks.js').ExternalLinkNode} ExternalLinkNode */
/** @typedef {import('./coverage.js').CoverageStatus} CoverageStatus */
/** @typedef {import('./graph/layout.js').GraphBuildModel} GraphBuildModel */
/** @typedef {import('./graph/layout.js').ModelGraphNode} ModelGraphNode */
/** @typedef {import('./graph/layout.js').LayoutNode} LayoutNode */
/** @typedef {import('./graph/layout.js').GraphLayoutResult} GraphLayoutResult */
/** @typedef {import('./graph/render.js').TweenItem} TweenItem */

/**
 * The whole of what the graph needs from a "document" - buildModel reads these
 * fields and nothing else. Deliberately NOT catalog.js's Doc: neither caller has
 * one. The doc map feeds the server index's slim node records (no source/rel/
 * url/name), and the coverage view feeds requirement/test pseudo-docs that were
 * never files at all. Only `id` is load-bearing; every other field defaults.
 * @typedef {Object} GraphInputDoc
 * @property {string} id
 * @property {string} [title]
 * @property {string} [description]
 * @property {string[]} [assumes] - prerequisite ids: each P yields edge P -> this
 * @property {string[]} [next] - recommended-next ids: each S yields edge this -> S
 * @property {string[]} [groups] - access groups that may read it (doc map only)
 * @property {boolean} [locked] - visible to this reader but not openable (doc map only)
 */

/**
 * The options object accepted by createGraphController(): a large config /
 * callback bag mixing doc-map-only features (onDelete/mapModes/focus),
 * coverage-view-only features (nodeStatus/nodeKind/autoSize), and edge data
 * (traceEdges/pageLinks/externalNodes). This file defines/defaults every
 * field; coverage-view.js is one concrete caller building an instance.
 * @typedef {Object} GraphOptions
 * @property {string|null} [currentId]
 * @property {(id: string) => void} [onOpenDoc] - fallback used for onSelect/onActivate when they are not given
 * @property {(id: string) => void} [onSelect] - single click / Enter
 * @property {(id: string) => void} [onActivate] - double click
 * @property {(from: string, to: string, type: string) => void} [onConnect]
 * @property {(from: string, to: string, type: string) => void} [onDisconnect]
 * @property {(id: string) => void} [onDelete]
 * @property {{value: string, label: string, swatch: string}[]} [mapModes]
 * @property {string|null} [mapMode]
 * @property {(mode: string) => void} [onMapMode]
 * @property {string[]} [accessGroups] - every access group named in this payload (doc map)
 * @property {Set<string>} [hiddenGroups] - groups toggled off in the group legend
 * @property {boolean} [focusMode]
 * @property {string|null} [focusId]
 * @property {() => void} [onFocusToggle]
 * @property {DocEdgeRef[]} [traceEdges]
 * @property {DocEdgeRef[]} [pageLinks]
 * @property {ExternalLinkNode[]} [externalNodes]
 * @property {Map<string,CoverageStatus>|Object<string,CoverageStatus>|null} [nodeStatus] - mutable via setStatus
 * @property {Map<string,string>|Object<string,string>|null} [nodeKind] - id -> 'req' | 'test' (coverage view)
 * @property {boolean} [autoSize]
 * @property {number} [maxNodeW]
 * @property {number} [maxNodeH]
 * @property {boolean} [hideLegend] - chrome-view.js only; the engine has no legend to hide
 * @property {HTMLCanvasElement|null} [minimapCanvas] - the surface to paint the minimap on. The
 *   engine draws it and handles clicks on it, but never creates it: the frame around it is chrome.
 * @property {{tx: number, ty: number, k: number}|null} [initialTransform]
 * @property {Map<string,{x:number,y:number}>|null} [animateFrom]
 */

/**
 * A positioned box in world space. Both a laid-out document node and an
 * external-link box resolve to this shape, which is why g.nodePos can return
 * either without the callers caring which they got.
 *
 * cx/cy are the tell between the two: a laid-out doc node always carries its
 * centre, an external box never does (positionExternal only ever sets x/y/w/h),
 * which is why code that wants a centre tests `cx != null` and falls back to
 * x + w/2 rather than branching on where the box came from.
 * @typedef {Object} GraphBox
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {number} [cx] - laid-out doc nodes only
 * @property {number} [cy] - laid-out doc nodes only
 */

/**
 * One precomputed edge in the draw list: its world polyline, bounding box and
 * category, built once per layout by render.js so the draw loop never
 * recomputes geometry.
 * @typedef {Object} GraphEdgeItem
 * @property {string} from
 * @property {string} to
 * @property {string} type
 * @property {string} cat - the visibility key looked up in g.vis
 * @property {{x: number, y: number}[]} pts
 * @property {[number, number, number, number]} aabb - [minx, miny, maxx, maxy]; an array, not an object, because the cull test indexes it per edge per frame
 * @property {string} head - which end carries the arrowhead, 'start' or 'end'
 */

/**
 * `g` - the shared mutable context created by createGraph() and threaded through
 * the whole pipeline. Every stage attaches its own fields to the same object, so
 * the context type is the intersection of what each stage contributes, and the
 * five stage typedefs below mirror the modules in ./graph/ one for one.
 *
 * Keep them in sync when a stage grows a field. This used to be a partial list
 * that openly admitted it was partial, which meant 85 of the 105 fields were
 * undeclared - and an undeclared field on a typed object is not an error at the
 * assignment, it is a silent `any` at every read site downstream.
 * @typedef {GraphCoreCtx & GraphRenderCtx & GraphViewCtx & GraphEditCtx & GraphInteractionCtx} GraphContext
 */

/**
 * Stage 1, this file: config, callbacks, edge data and the live transform.
 * @typedef {Object} GraphCoreCtx
 * @property {HTMLElement} container
 * @property {GraphOptions} opts
 * @property {GraphBuildModel} model
 * @property {ModelGraphNode[]} nodeList
 * @property {string[]} sortedIds - deterministic search order
 * @property {GraphLayoutResult} layout
 * @property {string|null} currentId
 * @property {(id: string) => void} onSelect - single click / Enter
 * @property {(id: string) => void} onActivate - double click
 * @property {DocEdgeRef[]} traceEdges
 * @property {DocEdgeRef[]} pageLinks
 * @property {ExternalLinkNode[]} externalNodes
 * @property {Map<string,CoverageStatus>|Object<string,CoverageStatus>|null} nodeStatus - mutable via setStatus
 * @property {(id: string) => (CoverageStatus|null)} statusOf
 * @property {(id: string) => (string|null)} kindOf
 * @property {((from: string, to: string, type: string) => void)|null} onConnect
 * @property {((from: string, to: string, type: string) => void)|null} onDisconnect
 * @property {boolean} editable - true when either connect callback was supplied
 * @property {((id: string) => void)|null} onDelete
 * @property {string|null} mapMode
 * @property {((mode: string) => void)|null} onMapMode
 * @property {Set<string>} hiddenGroups
 * @property {(name: string) => string} groupColor
 * @property {string|null} focusId
 * @property {{change: ((e: GraphChangeEvent) => void)[]}} listeners - subscribers, by event name
 * @property {() => void} emitChange - snapshot the reportable state and hand it to every subscriber
 * @property {number} tx - live transform: world -> screen translate x
 * @property {number} ty
 * @property {number} k - scale
 * @property {number} minK - lowered by fit() so a fitted whole-graph view can zoom back out
 * @property {boolean} editMode
 * @property {string} activeConnector
 * @property {string|null} pendingSource
 * @property {{from: string, to: string, type: string}|null} selectedEdge
 * @property {number|null} flashTimer
 * @property {ResizeObserver|null} ro
 * @property {boolean} fitted
 */

/**
 * Stage 2, ./graph/render.js: the canvas surface, the draw loop and the spatial
 * indexes the loop and hit-testing read.
 * @typedef {Object} GraphRenderCtx
 * @property {HTMLCanvasElement} canvas
 * @property {HTMLCanvasElement} svgEl - the same canvas; view.js/interactions.js address the surface under this name
 * @property {CanvasRenderingContext2D} ctx
 * @property {number} dpr
 * @property {number} cssW
 * @property {number} cssH
 * @property {Object<string,*>} colors - re-read from CSS custom properties on theme change
 * @property {Object<string,boolean>} vis - per-edge-category visibility, keyed by GraphEdgeItem.cat
 * @property {Set<string>} hiddenStatuses
 * @property {Map<string,GraphBox>} extPos - external-link boxes by id
 * @property {(id: string) => (GraphBox|null)} nodePos - resolves a doc node or an external box
 * @property {string|null} hoverId
 * @property {string|null} flashId
 * @property {number} flashUntil
 * @property {{items: TweenItem[], start: number, dur: number}|null} tween
 * @property {Map<string,{dx: number, dy: number}>|null} tweenOffset - per-node DELTA from the tweened-from position, not a position; nulled when the tween ends
 * @property {boolean} dirty
 * @property {boolean} running
 * @property {boolean} rafPending
 * @property {number} rafId
 * @property {() => void} resize
 * @property {() => void} requestDraw
 * @property {() => void} drawStop
 * @property {() => void} drawNow - synchronous full frame (perf harness / tests)
 * @property {MutationObserver} themeObs
 * @property {{cell: number, map: Map<string,string[]>}} grid - uniform spatial index for hit-testing
 * @property {(wx: number, wy: number) => (string|null)} nodeAtWorld
 * @property {(wx: number, wy: number, tol?: number) => ({from: string, to: string, type: string}|null)} edgeAtWorld - a bare edge ref, matching selectedEdge; the hit item itself is never handed out
 * @property {GraphEdgeItem[]} edgeItems
 * @property {Map<string,number[]>} edgesByNode - INDEXES into edgeItems, so an edge touching two visible nodes is de-duplicated by index rather than by object identity
 */

/**
 * Stage 3, ./graph/view.js: transform maths, framing, search and the minimap.
 * @typedef {Object} GraphViewCtx
 * @property {() => {w: number, h: number, rect: DOMRect}} viewSize
 * @property {() => void} applyTransform
 * @property {() => void} fit
 * @property {(px: number, py: number, factor: number) => void} zoomAround
 * @property {(factor: number) => void} zoomCenter
 * @property {(id: string) => void} flash
 * @property {(id: string) => boolean} focus
 * @property {(id: string) => void} setCurrent
 * @property {(query: string) => (string|null)} search
 * @property {() => void} buildMinimap
 * @property {() => void} updateMinimap
 * @property {number} miniScale
 * @property {number} miniOX
 * @property {number} miniOY
 * @property {HTMLCanvasElement} [miniCache] - offscreen minimap cache, created lazily
 * @property {HTMLCanvasElement|null} miniCanvas - opts.minimapCanvas, or null for no minimap
 * @property {CanvasRenderingContext2D|null} miniCtx
 */

/**
 * Stage 4, ./graph/chrome.js: the edit-mode state machine. No DOM: every one of
 * these mutates draw state and then reports through g.emitChange().
 * @typedef {Object} GraphEditCtx
 * @property {(type: string) => void} setConnector
 * @property {(on: boolean) => void} setEditMode
 * @property {(id: string) => void} markSource
 * @property {() => void} clearPending
 * @property {() => void} clearSelectedEdge
 * @property {(from: string, to: string, type: string) => void} selectEdge
 */

/**
 * Stage 5, ./graph/interactions.js: teardown. Pointer, wheel and keyboard
 * listeners are closed over rather than attached to the context.
 * @typedef {Object} GraphInteractionCtx
 * @property {() => void} destroy
 */

/**
 * One node's world-space box as nodePositions() reports it - a GraphBox with the
 * centre promised, since it only ever describes laid-out doc nodes.
 * @typedef {Object} GraphTestBox
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {number} cx
 * @property {number} cy
 */

/**
 * The hit-test hook parked on `window.__graph`. The map is one <canvas> with no
 * per-node DOM, so an e2e driver has nothing to query for; this is how it turns
 * a document id into screen pixels and back. Coordinates crossing this boundary
 * are CLIENT (viewport) pixels, not world units.
 * @typedef {Object} GraphTestApi
 * @property {(clientX: number, clientY: number) => (string|null)} nodeAt
 * @property {(clientX: number, clientY: number) => (string|null)} hitTest - alias of nodeAt
 * @property {() => Object<string, GraphTestBox>} nodePositions - world space
 * @property {(id: string) => ({x: number, y: number}|null)} center - client pixels
 * @property {() => {tx: number, ty: number, k: number}} transform
 * @property {(t: {tx?: number, ty?: number, k?: number}) => void} setTransform
 * @property {() => void} redraw
 * @property {() => number} count
 */

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
 * @typedef {Object} GraphChangeEvent
 * @property {boolean} editMode
 * @property {string} connector - the armed connection type, 'prereq' | 'recnext'
 * @property {string|null} pendingSourceTitle - first node of a half-finished connect gesture
 * @property {{from: string, to: string, type: string}|null} selectedEdge
 * @property {Object<string,boolean>} visibility - per-edge-category, keyed by GraphEdgeItem.cat
 * @property {Set<string>} hiddenGroups
 */

/**
 * The controller: everything the outside world may do to a live graph.
 *
 * Deliberately small and deliberately one-way. Commands go in as method calls,
 * state comes back as change events, and nothing in here hands out the context,
 * the model, an element or a listener. Anything a caller cannot express through
 * this surface is a rebuild - build a new controller and destroy the old one,
 * which is what a re-layout has always been.
 * @typedef {Object} GraphController
 * @property {() => void} destroy
 * @property {() => void} fit
 * @property {(id: string) => boolean} focus
 * @property {(query: string) => (string|null)} search
 * @property {(id: string) => void} setCurrent
 * @property {(on: boolean) => void} setEditMode
 * @property {(type: string) => void} setConnector
 * @property {(mode: string) => void} setMapMode
 * @property {(cat: string, on: boolean) => void} setVisibility
 * @property {(names: Iterable<string>) => void} setHiddenGroups
 * @property {(m: Map<string,CoverageStatus>|Object<string,CoverageStatus>) => void} setStatus
 * @property {(hidden: Iterable<string>) => void} setStatusFilter
 * @property {(factor: number) => void} zoomBy
 * @property {() => {tx: number, ty: number, k: number}} getTransform
 * @property {() => GraphChangeEvent} getEditState
 * @property {() => Map<string,{x: number, y: number}>} getNodePositions
 * @property {(evt: string, cb: (e: GraphChangeEvent) => void) => (() => void)} on
 */

/**
 * Snapshot the reportable state. Built fresh on every emit rather than mutated,
 * so a subscriber can keep the object it was handed.
 * @param {GraphContext} g
 * @returns {GraphChangeEvent}
 */
function changeEvent(g) {
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
 * @param {HTMLElement} canvasEl - the element the engine's <canvas> lives in
 * @param {GraphInputDoc[]} docs
 * @param {GraphOptions} [options]
 * @returns {GraphController}
 */
export function createGraphController(canvasEl, docs, options) {
  const opts = options || {};
  // `g` is only a whole GraphContext once every stage below has attached its own
  // fields, so it is declared as one up front rather than accumulating an
  // inferred shape that each stage would then have to be trusted to widen.
  const g = /** @type {GraphContext} */ ({ container: canvasEl, opts: opts });

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
  g.statusOf = (id) => g.nodeStatus ? (g.nodeStatus.get ? /** @type {Map<string,CoverageStatus>} */ (g.nodeStatus).get(id) : /** @type {Object<string,CoverageStatus>} */ (g.nodeStatus)[id]) : null;
  const nodeKind = opts.nodeKind || null;     // Map/obj id -> 'req' | 'test' (coverage view)
  g.kindOf = (id) => nodeKind ? (nodeKind.get ? /** @type {Map<string,string>} */ (nodeKind).get(id) : /** @type {Object<string,string>} */ (nodeKind)[id]) : null;
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
    /** @type {Set<string>} */
    const nb = new Set();
    /**
     * @param {string} a
     * @param {string} b
     */
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
  const testWindow = /** @type {typeof window & {__graph: GraphTestApi|null}} */ (/** @type {unknown} */ (window));
  /** @type {GraphTestApi} */
  const hook = {
    nodeAt: function (clientX, clientY) { const r = g.svgEl.getBoundingClientRect(); return g.nodeAtWorld((clientX - r.left - g.tx) / g.k, (clientY - r.top - g.ty) / g.k); },
    hitTest: function (clientX, clientY) { return hook.nodeAt(clientX, clientY); },
    nodePositions: function () {
      /** @type {Object<string, GraphTestBox>} */
      const m = {};
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
      const m = new Map();
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
 * @param {HTMLElement} container - a stage element the graph and its chrome may fill
 * @param {GraphInputDoc[]} docs
 * @param {GraphOptions} [options]
 * @returns {GraphController}
 */
export function createGraph(container, docs, options) {
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
 * @param {GraphContext} g
 * @param {Map<string,{x:number,y:number}>} from - previous world position per node/external-node id
 * @returns {void}
 */
function animateRelayout(g, from) { startTween(g, from); }
