import type { DocEdgeRef } from './requirements.js';
import type { ExternalLinkNode } from './doclinks.js';
import type { CoverageStatus } from './coverage.js';
import type { GraphBuildModel, ModelGraphNode, GraphLayoutResult } from './graph/layout.js';
import type { TweenItem, GraphColors } from './graph/render.js';
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
 * callback bag mixing doc-map-only features (onDelete/mapMode/focusId),
 * coverage-view-only features (nodeStatus/nodeKind/autoSize), and edge data
 * (traceEdges/pageLinks/externalNodes). This file defines/defaults every
 * field; MapOverlay.svelte and CoverageOverlay.svelte are the two concrete
 * callers building an instance.
 *
 * IT IS ENGINE OPTIONS ONLY NOW. The fields that existed for the vanilla
 * chrome to render - the list of offered map modes, the roster of access
 * groups, the focus toggle, hideLegend - went when the map's chrome became
 * components and graph/chrome-view.js stopped rendering any of them. What is
 * left is what the CANVAS reads.
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
    mapMode?: string | null;
    onMapMode?: (mode: string) => void;
    /** groups toggled off in the group legend */
    hiddenGroups?: Set<string>;
    focusId?: string | null;
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
    /**
     * The surface to paint the minimap on. The engine draws it and handles clicks
     * on it, but never creates it: the frame around it is chrome.
     */
    minimapCanvas?: HTMLCanvasElement | null;
    initialTransform?: {
        tx: number;
        ty: number;
        k: number;
    } | null;
    animateFrom?: Map<string, {
        x: number;
        y: number;
    }> | null;
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
    pts: {
        x: number;
        y: number;
    }[];
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
    listeners: {
        change: ((e: GraphChangeEvent) => void)[];
    };
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
    selectedEdge: {
        from: string;
        to: string;
        type: string;
    } | null;
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
    tween: {
        items: TweenItem[];
        start: number;
        dur: number;
    } | null;
    /**
     * per-node DELTA from the tweened-from position, not a position; nulled when
     * the tween ends
     */
    tweenOffset: Map<string, {
        dx: number;
        dy: number;
    }> | null;
    dirty: boolean;
    running: boolean;
    rafPending: boolean;
    rafId: number;
    resize: () => void;
    requestDraw: () => void;
    drawStop: () => void;
    /** synchronous full frame (perf harness / tests) */
    drawNow: () => void;
    /** nulled by destroy(), like g.ro, so a torn-down context holds no observer */
    themeObs: MutationObserver | null;
    /** uniform spatial index for hit-testing */
    grid: {
        cell: number;
        map: Map<string, string[]>;
    };
    nodeAtWorld: (wx: number, wy: number) => (string | null);
    /**
     * A bare edge ref, matching selectedEdge; the hit item itself is never handed
     * out.
     */
    edgeAtWorld: (wx: number, wy: number, tol?: number) => ({
        from: string;
        to: string;
        type: string;
    } | null);
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
    viewSize: () => {
        w: number;
        h: number;
        rect: DOMRect;
    };
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
 * Stage 4, ./graph/edit-state.js: the edit-mode state machine. No DOM: every one of
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
    center: (id: string) => ({
        x: number;
        y: number;
    } | null);
    transform: () => {
        tx: number;
        ty: number;
        k: number;
    };
    setTransform: (t: {
        tx?: number;
        ty?: number;
        k?: number;
    }) => void;
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
    selectedEdge: {
        from: string;
        to: string;
        type: string;
    } | null;
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
    getTransform: () => {
        tx: number;
        ty: number;
        k: number;
    };
    getEditState: () => GraphChangeEvent;
    getNodePositions: () => Map<string, {
        x: number;
        y: number;
    }>;
    on: (evt: string, cb: (e: GraphChangeEvent) => void) => (() => void);
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
export declare function createGraphController(canvasEl: HTMLElement, docs: GraphInputDoc[], options?: GraphOptions): GraphController;
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
export declare function createGraph(container: HTMLElement, docs: GraphInputDoc[], options?: GraphOptions): GraphController;
