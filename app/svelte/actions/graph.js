// graph.js - the two `use:` actions that hand a node to app/js/graph.js's canvas
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
// The specifier stays "/js/graph.js" so vite.config.js keeps it EXTERNAL and the
// browser resolves it against the same module instance map-view.js uses.

/** @typedef {import('/js/graph.js').GraphInputDoc} GraphInputDoc */
/** @typedef {import('/js/graph.js').GraphOptions} GraphOptions */
/** @typedef {import('/js/graph.js').GraphChangeEvent} GraphChangeEvent */
/** @typedef {ReturnType<typeof import('/js/graph.js').createGraph>} GraphApi */

/**
 * Everything an action needs, in one object so the whole payload is written at
 * a single `use:` site.
 *
 * `onReady` is the seam back to the component. An action's return value is not
 * reachable from markup, and the controller only exists once the dynamic import
 * has landed - so the api is PUSHED rather than pulled, and pushed as null again
 * on teardown so no effect can call into a destroyed graph.
 * @typedef {Object} GraphActionParams
 * @property {GraphInputDoc[]} docs - the pseudo-documents to lay out
 * @property {GraphOptions} options - everything except initialTransform, which is this module's
 * @property {(api: GraphApi|null) => void} onReady
 */

/**
 * `graphCanvas`'s payload: the same, plus the way out.
 *
 * `options` is honoured AS WRITTEN here, initialTransform included - the caller
 * owns the view memory, which is the whole difference between the two actions.
 * @typedef {Object} GraphCanvasParams
 * @property {GraphInputDoc[]} docs
 * @property {GraphOptions} options
 * @property {(api: GraphApi|null) => void} onReady
 * @property {(view: GraphViewSnapshot) => void} onTeardown - the outgoing controller's state, handed back BEFORE destroy
 */

/**
 * What a controller knows that nothing else can reconstruct once it is gone:
 * where the reader was looking, where every node sat, and what the legend and
 * edit toggles were showing.
 * @typedef {Object} GraphViewSnapshot
 * @property {{tx: number, ty: number, k: number}} transform
 * @property {Map<string,{x: number, y: number}>} positions
 * @property {GraphChangeEvent} editState
 */

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
 * document map keeps its own memory in stores/map.svelte.js, which is why
 * `graphCanvas` does not touch this.
 * @type {{tx: number, ty: number, k: number}|null}
 */
let savedTransform = null;

/**
 * The shared body of both actions: import the engine, build a controller, push
 * it to the component, and tear it down in the right order.
 *
 * `make` picks the factory out of the module rather than being handed one,
 * because the module does not exist until the dynamic import resolves.
 * @param {HTMLElement} node
 * @param {GraphActionParams} params
 * @param {(mod: typeof import('/js/graph.js')) => ((el: HTMLElement, docs: GraphInputDoc[], options: GraphOptions) => GraphApi)} make
 * @param {GraphOptions} options - the options to build with, after whichever action's own seeding
 * @param {(api: GraphApi) => void} remember - called while the controller is still alive, immediately before destroy
 * @returns {{destroy: () => void}}
 */
function attach(node, params, make, options, remember) {
  /** @type {GraphApi|null} */
  let api = null;
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
 * @param {HTMLElement} node - an element with no Svelte-rendered children
 * @param {GraphActionParams} params
 * @returns {{destroy: () => void}}
 */
export function graph(node, params) {
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
 * @param {HTMLElement} node - an element with no Svelte-rendered children
 * @param {GraphCanvasParams} params
 * @returns {{destroy: () => void}}
 */
export function graphCanvas(node, params) {
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
