// graph.ts - the two `use:` actions that hand a node to app/js/graph.js's canvas
// engine.
//
// THE CARVE-OUT. The engine writes a <canvas> - and, in `graph`'s case, a
// minimap, a search box and a pointer/wheel/keyboard state machine - into the
// element it is given. Nothing about that is expressible as markup, and any
// attempt to let Svelte diff inside it would fight the renderer for the same
// nodes. So the component renders ONE empty <div> and the action gives it away:
// from mount to destroy the engine owns every child of that element.
//
// It no longer CLEARS that element on the way in, and its teardown removes only
// what it added - which is what let the map's chrome become components while the
// canvas stayed the engine's.
//
// TWO ACTIONS, ONE BODY.
//
//   graph        - engine PLUS the vanilla chrome (createGraph). The coverage
//                  view's map: it wants zoom controls, a search box and a
//                  minimap, and has no components of its own for them. This
//                  module remembers its pan/zoom, because nothing else does.
//   graphCanvas  - the bare controller (createGraphController) and nothing else.
//                  The document map: its chrome is components now, so the
//                  CALLER owns both the options (including where the minimap
//                  surface came from) and the view memory, and gets the outgoing
//                  controller's state handed back before it is destroyed.
//
// They are separate exports rather than one action with a flag because the two
// callers disagree about who remembers the view, and a boolean that silently
// switches ownership of state is the kind of parameter that gets passed wrong.
//
// WHY THE IMPORT IS DYNAMIC. app/js/graph.js plus app/js/graph/*.js is ~2,000
// lines, and main.js loads the island bundle at boot for every reader (the
// drawer tree is an island). A static `import '/js/graph.js'` here would become
// a static import OF THE BUNDLE, so opening a document would download the whole
// graph engine for a reader who never presses Map or Coverage - undoing the
// lazy-import work overlays.js exists to protect. Deferring it to the first
// mount keeps the cost where it was: paid by the click that needs it.
//
// The specifier stays "/js/graph.js" so vite.config.ts keeps it EXTERNAL and the
// browser resolves it against the same module instance map-view.js uses.
import type { GraphChangeEvent, GraphController, GraphInputDoc, GraphOptions } from '/js/graph.js';

/**
 * The live controller, under the name this module's callers know it by.
 * `createGraph` and `createGraphController` both return one; the difference
 * between the two actions is what is around it, never what comes back.
 */
export type GraphApi = GraphController;

/** The pan/zoom the engine hands back from getTransform(). */
export interface GraphTransform {
  tx: number;
  ty: number;
  k: number;
}

/**
 * Everything an action needs, in one object so the whole payload is written at
 * a single `use:` site.
 *
 * `onReady` is the seam back to the component. An action's return value is not
 * reachable from markup, and the controller only exists once the dynamic import
 * has landed - so the api is PUSHED rather than pulled, and pushed as null again
 * on teardown so no effect can call into a destroyed graph.
 */
export interface GraphActionParams {
  /** the pseudo-documents to lay out */
  docs: GraphInputDoc[];
  /** everything except initialTransform, which is this module's */
  options: GraphOptions;
  onReady: (api: GraphApi | null) => void;
}

/**
 * `graphCanvas`'s payload: the same, plus the way out.
 *
 * `options` is honoured AS WRITTEN here, initialTransform included - the caller
 * owns the view memory, which is the whole difference between the two actions.
 */
export interface GraphCanvasParams extends GraphActionParams {
  /** the outgoing controller's state, handed back BEFORE destroy */
  onTeardown: (view: GraphViewSnapshot) => void;
}

/**
 * What a controller knows that nothing else can reconstruct once it is gone:
 * where the reader was looking, where every node sat, and what the legend and
 * edit toggles were showing.
 */
export interface GraphViewSnapshot {
  transform: GraphTransform;
  positions: Map<string, { x: number; y: number }>;
  editState: GraphChangeEvent;
}

/**
 * The last pan/zoom the COVERAGE map was left at, remembered ACROSS teardown.
 *
 * This is coverage-view.js's `covTransform` moved intact, and it is module state
 * for the same reason it was module state there: a rebuild (a link changed) and
 * a reopen (the overlay closed and came back) both destroy the controller, and
 * both must land the reader back where they were looking rather than refitting
 * the whole graph under them. The read happens on create and the write happens
 * BEFORE destroy(), because a destroyed controller has no transform to give.
 *
 * One slot, not a map keyed by node: `graph` has exactly one caller. The
 * document map keeps its own memory in stores/map.svelte.ts, which is why
 * `graphCanvas` does not touch this.
 */
let savedTransform: GraphTransform | null = null;

/** The factory an action picks out of the engine module once it has landed. */
type GraphFactory = (el: HTMLElement, docs: GraphInputDoc[], options: GraphOptions) => GraphApi;

/**
 * The shared body of both actions: import the engine, build a controller, push
 * it to the component, and tear it down in the right order.
 *
 * `make` picks the factory out of the module rather than being handed one,
 * because the module does not exist until the dynamic import resolves.
 * @param options - the options to build with, after whichever action's own seeding
 * @param remember - called while the controller is still alive, immediately before destroy
 */
function attach(
  node: HTMLElement,
  params: GraphActionParams,
  make: (mod: typeof import('/js/graph.js')) => GraphFactory,
  options: GraphOptions,
  remember: (api: GraphApi) => void,
): { destroy: () => void } {
  let api: GraphApi | null = null;
  // The import is a round trip, and the overlay can be closed inside it. Without
  // this latch a fast open-close would build a graph into a detached node and
  // leave its rAF loop running - and, worse, leave window.__graph pointing at it.
  let live = true;

  import('/js/graph.js').then((mod) => {
    if (!live) return;
    api = make(mod)(node, params.docs, options);
    params.onReady(api);
  });

  // No `update`. Svelte only re-reads the params expression when the payload
  // declares one (see svelte/internal/.../actions.js), so leaving it out is what
  // makes the params a one-shot read - and a graph is rebuilt by replacing the
  // whole node through a {#key} block, never by patching it in place.
  return {
    destroy() {
      live = false;
      if (!api) return;
      remember(api);          // BEFORE destroy, while there is still a view to save
      params.onReady(null);   // stop the effects before the controller goes
      api.destroy();
      api = null;
    },
  };
}

/**
 * Engine + this repo's vanilla chrome, into a node the component gives away.
 * @param node - an element with no Svelte-rendered children
 */
export function graph(node: HTMLElement, params: GraphActionParams): { destroy: () => void } {
  return attach(
    node,
    params,
    (mod) => mod.createGraph,
    Object.assign({}, params.options, {
      initialTransform: savedTransform,   // null on the very first open -> the engine fits
    }),
    (api) => { savedTransform = api.getTransform(); },
  );
}

/**
 * The bare controller: one <canvas> in `node`, no chrome, and the outgoing
 * state handed back on the way out.
 *
 * Nothing here decides what the next instance opens at. That is the caller's,
 * because the document map's answer depends on WHY it is rebuilding - a focus
 * change reframes, an edit-connections rebuild must not - and a module-level
 * slot could not tell those apart.
 * @param node - an element with no Svelte-rendered children
 */
export function graphCanvas(node: HTMLElement, params: GraphCanvasParams): { destroy: () => void } {
  return attach(
    node,
    params,
    (mod) => mod.createGraphController,
    params.options,
    (api) => params.onTeardown({
      transform: api.getTransform(),
      positions: api.getNodePositions(),
      editState: api.getEditState(),
    }),
  );
}
