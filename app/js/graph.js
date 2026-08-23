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
//   edit-state.js    the edit-mode state machine (state only - no DOM)
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
import { attachEditState } from './graph/edit-state.js';
import { mountGraphChrome } from './graph/chrome-view.js';
import { wireInteractions } from './graph/interactions.js';
import { groupColor } from './auth.js';
// Re-exported for isolated unit testing of the layout math.
export { buildModel, layoutGraph } from './graph/layout.js';
/**
 * Snapshot the reportable state. Built fresh on every emit rather than mutated,
 * so a subscriber can keep the object it was handed.
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
 * @param canvasEl - the element the engine's <canvas> lives in
 */
export function createGraphController(canvasEl, docs, options) {
    const opts = options || {};
    // `g` is only a whole GraphContext once every stage below has attached its own
    // fields, so it is declared as one up front rather than accumulating an
    // inferred shape that each stage would then have to be trusted to widen.
    const g = { container: canvasEl, opts: opts };
    // --- config / callbacks ---
    g.currentId = opts.currentId || null;
    const onOpenDoc = typeof opts.onOpenDoc === 'function' ? opts.onOpenDoc : function () { };
    g.onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : onOpenDoc; // single click / Enter
    g.onActivate = typeof opts.onActivate === 'function' ? opts.onActivate : onOpenDoc; // double click
    g.traceEdges = Array.isArray(opts.traceEdges) ? opts.traceEdges : [];
    g.pageLinks = Array.isArray(opts.pageLinks) ? opts.pageLinks : [];
    g.externalNodes = Array.isArray(opts.externalNodes) ? opts.externalNodes : [];
    // Both lookups accept a Map OR a plain object, so `.get` doubles as the probe
    // for which one arrived; the cast just tells the checker what that probe proved.
    g.nodeStatus = opts.nodeStatus || null; // Map/obj id -> {status, pct} for the coverage view (mutable via setStatus)
    // The trailing `?? null` normalises the miss: a Map reports it as undefined and
    // an object as undefined too, and both callers ask "is there a status" - so one
    // absent value, not two.
    g.statusOf = (id) => (g.nodeStatus ? (g.nodeStatus.get ? g.nodeStatus.get(id) : g.nodeStatus[id]) : null) ?? null;
    const nodeKind = opts.nodeKind || null; // Map/obj id -> 'req' | 'test' (coverage view)
    g.kindOf = (id) => (nodeKind ? (nodeKind.get ? nodeKind.get(id) : nodeKind[id]) : null) ?? null;
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
    // of every group to OFFER is the legend's business, and the legend is
    // GroupLegend.svelte, which reads it off the map model without asking us.
    g.hiddenGroups = opts.hiddenGroups instanceof Set ? new Set(opts.hiddenGroups) : new Set();
    g.groupColor = groupColor;
    // Focus mode (doc map): when a node is focused, the map is laid out radially
    // around it (its links ringed like sun-rays, every other node pushed far out).
    // Toggling the MODE re-lays-out, so it is a rebuild, not a method: the engine
    // only ever sees which node - if any - this instance was built around.
    g.focusId = opts.focusId || null;
    // --- mutable state ---
    g.tx = 0;
    g.ty = 0;
    g.k = 1; // live transform
    g.miniScale = 1;
    g.miniOX = 0;
    g.miniOY = 0;
    g.editMode = false;
    g.activeConnector = 'recnext';
    g.pendingSource = null;
    g.selectedEdge = null;
    g.flashTimer = null;
    g.ro = null;
    g.fitted = false;
    // The minimap SURFACE comes from outside; the frame around it is chrome. view.js
    // and interactions.js both already treat a missing one as "no minimap".
    g.miniCanvas = opts.minimapCanvas || null;
    g.miniCtx = g.miniCanvas ? g.miniCanvas.getContext('2d') : null;
    // --- the outward report ---
    g.listeners = { change: [] };
    g.emitChange = function () {
        if (!g.listeners.change.length)
            return;
        const ev = changeEvent(g);
        // Iterate a copy: a subscriber is allowed to unsubscribe from inside its own
        // callback, and splicing the live array mid-loop would skip its neighbour.
        for (const cb of g.listeners.change.slice()) {
            try {
                cb(ev);
            }
            catch (err) { /* one bad subscriber must not stop the rest */ }
        }
    };
    // --- pipeline ---
    g.model = buildModel(docs || []);
    g.nodeList = Array.from(g.model.nodes.values());
    g.sortedIds = Array.from(g.model.nodes.keys()).sort(); // deterministic search order
    const sizeOverride = opts.autoSize ? computeNodeSize(g) : null;
    const layoutOpts = Object.assign({}, sizeOverride || {}, { layoutMode: g.mapMode || 'all' });
    if (g.focusId && g.model.nodes.has(g.focusId)) {
        // The ring = every DOC node directly linked to the focus by ANY edge type:
        // prereq/recnext + requirement-trace + doc page links. In focus view only the
        // edges that TOUCH the focused node stay visible (see render.js edgeShown).
        const nb = new Set();
        const rel = (a, b) => { if (a === g.focusId)
            nb.add(b);
        else if (b === g.focusId)
            nb.add(a); };
        for (const e of g.model.edges)
            rel(e.from, e.to);
        for (const te of g.traceEdges)
            rel(te.from, te.to);
        for (const pl of g.pageLinks) {
            if (String(pl.to).indexOf('ext:') !== 0)
                rel(pl.from, pl.to);
        }
        nb.delete(g.focusId);
        g.layout = focusLayout(g.nodeList, g.model.edges, g.focusId, nb, layoutOpts);
    }
    else {
        g.focusId = null; // absent / not a real node -> hierarchy
        g.layout = layoutGraph(g.nodeList, g.model.edges, layoutOpts);
    }
    positionExternal(g); // g.extPos, g.nodePos (+ extends layout bounds)
    renderScene(g); // g.canvas / g.svgEl / g.vis + all drawing
    attachView(g); // g.applyTransform, fit, zoom, focus, setCurrent, search, minimap
    attachEditState(g); // g.setConnector / markSource / selectEdge / setEditMode - state, no DOM
    wireInteractions(g); // pointer/wheel/keyboard + init fit/flash + g.destroy
    // Fancy re-layout: given the previous node positions, tween each node from where
    // it was to where it landed (mode switch / edit rebuild re-arranges live).
    if (opts.animateFrom instanceof Map && opts.animateFrom.size)
        animateRelayout(g, opts.animateFrom);
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
    const testWindow = window;
    const hook = {
        nodeAt: function (clientX, clientY) { const r = g.svgEl.getBoundingClientRect(); return g.nodeAtWorld((clientX - r.left - g.tx) / g.k, (clientY - r.top - g.ty) / g.k); },
        hitTest: function (clientX, clientY) { return hook.nodeAt(clientX, clientY); },
        nodePositions: function () {
            const m = {};
            g.layout.nodes.forEach((n, id) => { m[id] = { x: n.x, y: n.y, w: n.w, h: n.h, cx: n.cx, cy: n.cy }; });
            return m;
        },
        center: function (id) { const r = g.svgEl.getBoundingClientRect(); const n = g.layout.nodes.get(id) || (g.extPos && g.extPos.get(id)); return n ? { x: r.left + (n.cx != null ? n.cx : n.x + n.w / 2) * g.k + g.tx, y: r.top + (n.cy != null ? n.cy : n.y + n.h / 2) * g.k + g.ty } : null; },
        transform: function () { return { tx: g.tx, ty: g.ty, k: g.k }; },
        // Every field is optional, so each one is probed for presence before being
        // range-checked - isFinite(undefined) was already false, this just says so.
        setTransform: function (t) { if (t) {
            if (t.tx != null && isFinite(t.tx))
                g.tx = t.tx;
            if (t.ty != null && isFinite(t.ty))
                g.ty = t.ty;
            if (t.k != null && isFinite(t.k))
                g.k = t.k;
            g.applyTransform();
        } },
        redraw: function () { if (g.drawNow)
            g.drawNow(); },
        count: function () { return g.model.nodes.size; }
    };
    testWindow.__graph = hook;
    return {
        destroy: function () {
            g.destroy(); // listeners, observers, rAF loop, and the <canvas>
            g.listeners.change.length = 0;
            // Identity-checked: if another controller has since installed its own hook,
            // this one's teardown must not blank it. (The map and the coverage view are
            // both full-screen overlays and each closes the other, but the ORDER of
            // close-then-open is the app's business, not something to depend on here.)
            if (testWindow.__graph === hook)
                testWindow.__graph = null;
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
            if (!mode || mode === g.mapMode)
                return;
            g.mapMode = mode;
            if (g.onMapMode)
                g.onMapMode(mode);
        },
        /**
         * Show or hide one edge category. Draw state, so a repaint plus a report -
         * the legend entry that asked for it learns the outcome the same way any
         * other subscriber does.
         */
        setVisibility: function (cat, on) {
            if (!(cat in g.vis) || g.vis[cat] === !!on)
                return;
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
            if (g.extPos)
                g.extPos.forEach((p, id) => m.set(id, { x: p.x, y: p.y }));
            return m;
        },
        /**
         * Subscribe to 'change'. Returns the unsubscribe, which is the only way off
         * the list - there is no off(), because a token you have to keep is harder to
         * lose than a callback identity you have to reproduce.
         */
        on: function (evt, cb) {
            const list = evt === 'change' ? g.listeners.change : null;
            if (!list || typeof cb !== 'function')
                return function () { };
            list.push(cb);
            return function () { const i = list.indexOf(cb); if (i >= 0)
                list.splice(i, 1); };
        }
    };
}
/**
 * The engine plus this repo's standard vanilla chrome, composed into `container`.
 *
 * Kept for ONE caller: the coverage view's `use:graph` action, a dynamic import
 * away. It hands over a whole stage element and expects a graph with zoom
 * controls, a search box and a minimap in it, and has no components of its own
 * for those. The document map went the other way - it builds
 * createGraphController directly and renders its chrome as Svelte - so this
 * pairing is the coverage view's alone. It is a composition, not a layer: it
 * adds no behaviour of its own, and everything it returns is the controller's.
 * @param container - a stage element the graph and its chrome may fill
 */
export function createGraph(container, docs, options) {
    const opts = options || {};
    // Chrome is BUILT first (it adds .graph-root, which is what gives the stage its
    // height - and the engine measures that height while fitting) but APPENDED last,
    // by connect(), so the canvas keeps its place at the front of the container.
    const chrome = mountGraphChrome(container);
    const ctl = createGraphController(container, docs, Object.assign({}, opts, { minimapCanvas: chrome.minimapCanvas }));
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
function animateRelayout(g, from) { startTween(g, from); }
