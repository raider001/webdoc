// map.svelte.js - the document map's own state.
//
// WHY A STORE RATHER THAN COMPONENT STATE. MapOverlay.svelte is mounted when the
// reader opens the map and UNMOUNTED when they close it - the same discipline
// islands/coverage.js imposes on the coverage view, and for the same reason: a
// live canvas view keeps a requestAnimationFrame loop running and keeps
// window.__graph pointing at a graph nobody can see. So anything that has to
// survive a close and reopen cannot live in the component. This file is
// app/js/map-view.js's old module-level `docMapState` singleton, moved intact.
//
// TWO KINDS OF STATE LIVE HERE, and telling them apart is the whole point.
//
//   * REACTIVE (`mapState`). Read by markup. Deliberately five fields, not
//     twelve: a field belongs here only if something on screen changes when it
//     changes. `version` is the one an effect tracks - see the {#key} block in
//     MapOverlay.svelte - because it answers the only question a component has
//     to re-ask: "is this a different LAYOUT from the one on screen?".
//
//   * SEEDS (the module variables below `mapState`). The pan/zoom, the previous
//     node positions and the edit/legend state are read exactly ONCE, while a
//     controller is being built, and nothing renders from them - the chrome
//     draws itself from the controller's own change event instead. Making them
//     runes would invite an effect to depend on a value that changes on every
//     mouse-drag, and would mean writing state during a render.
//
// THE HARVEST ORDER IS LOAD-BEARING. Svelte's {#key} creates the new branch
// BEFORE it destroys the old one (see BranchManager#ensure -> #commit), so at
// the moment the new controller is built the OUTGOING one is still alive and is
// the only thing that can say where the reader was looking and where every node
// currently sits. MapOverlay therefore calls rememberMapView() from its params
// builder, not from a teardown - a teardown would write these seeds AFTER the
// build that needed them, and the map would silently reopen on the pan/zoom from
// two rebuilds ago.
//
// The `.svelte.js` extension is required - it is what tells the compiler to
// process runes in a plain module rather than treat $state as an undefined name.

/** @typedef {import('/js/graph-model.js').GraphModel} GraphModel */
/** @typedef {import('/js/graph.js').GraphChangeEvent} GraphChangeEvent */

/**
 * @typedef {Object} MapState
 * @property {GraphModel|null} model - the server graph, fetched by map-view.js; null until the first open
 * @property {number} version - the LAYOUT token: bumped for anything the live instance cannot become (a new model, a new "Map by" mode, a focus change), and read by nothing except the {#key} that rebuilds the canvas
 * @property {string} mapMode - which connection type drives the tree layout: 'all' | 'recnext' | 'prereq'
 * @property {boolean} focusMode - clicking a node centres the map on it instead of routing to it
 * @property {string|null} focusId - the radial-focus centre, or null for the hierarchy
 */

/** @type {MapState} */
export const mapState = $state({
  model: null,
  version: 0,
  mapMode: 'all',
  focusMode: false,
  focusId: null,
});

/**
 * The last pan/zoom, restored on the next build so neither a rebuild nor a
 * close-and-reopen moves the view under the reader.
 * @type {{tx: number, ty: number, k: number}|null}
 */
let savedTransform = null;
/**
 * Where every node sat in the OUTGOING layout, so the renderer can tween each
 * one into its new place. Null until a controller has been harvested.
 * @type {Map<string,{x: number, y: number}>|null}
 */
let savedPositions = null;
/** @type {boolean} */
let savedEditMode = false;
/** @type {string} */
let savedConnector = 'recnext';
/**
 * Access groups switched off in the group legend.
 *
 * A plain ARRAY, and replaced rather than added to. It is a seed - the live set
 * a legend entry paints itself from is the one inside the controller's change
 * event - so it needs no reactivity, and keeping it as an array makes "this is
 * never mutated in place" true by construction rather than by discipline. The
 * engine copies whatever Set it is handed anyway; this is the other half of that
 * bargain.
 * @type {string[]}
 */
let savedHiddenGroups = [];

/** Tween the next build from savedPositions. Set by nextLayout(), read by mapBuildSeeds(). */
let animate = false;
/** Fit the next build fresh instead of restoring savedTransform (a focus change reframes). */
let refit = false;

/**
 * Everything a new controller needs in order to open exactly where the old one
 * left off. Built fresh on every call so the caller may keep it.
 * @typedef {Object} MapBuildSeeds
 * @property {{tx: number, ty: number, k: number}|null} initialTransform - null means "fit to the new frame"
 * @property {Map<string,{x: number, y: number}>|null} animateFrom - null means "no tween"
 * @property {boolean} editMode
 * @property {string} connector
 * @property {string[]} hiddenGroups - still an array; the caller makes the Set the engine wants
 */

/** @returns {MapBuildSeeds} */
export function mapBuildSeeds() {
  return {
    initialTransform: refit ? null : savedTransform,
    animateFrom: animate ? savedPositions : null,
    editMode: savedEditMode,
    connector: savedConnector,
    // A COPY, not the stored array. Handing out the live one would let the
    // caller - or the engine it passes it to - hold the same object this module
    // reads from, and "two writers, one collection" is the exact bug the whole
    // reassign-never-mutate rule around hidden groups exists to prevent.
    hiddenGroups: savedHiddenGroups.slice(),
  };
}

/**
 * Fold a live controller's state back into the seeds. Called with the OUTGOING
 * controller just before a rebuild, and again when the overlay is torn down, so
 * the map remembers the same things whichever way it was left.
 * @param {{tx: number, ty: number, k: number}} transform
 * @param {Map<string,{x: number, y: number}>} positions
 * @param {GraphChangeEvent} editState
 * @returns {void}
 */
export function rememberMapView(transform, positions, editState) {
  savedTransform = transform;
  savedPositions = positions;
  savedEditMode = editState.editMode;
  savedConnector = editState.connector;
  savedHiddenGroups = Array.from(editState.hiddenGroups);
}

/**
 * Ask for a new layout: the live instance cannot become it, so the {#key} block
 * replaces the whole controller.
 * @param {boolean} [withTween] - animate nodes from their previous positions
 * @param {boolean} [reframe] - fit fresh instead of restoring the saved pan/zoom
 * @returns {void}
 */
export function nextLayout(withTween, reframe) {
  animate = !!withTween;
  refit = !!reframe;
  mapState.version++;
}

/**
 * Replace the server graph model and relayout. The vanilla shell's only way in:
 * app/js/map-view.js fetches (and app/js/overlays.js's requestMapRebuild
 * re-fetches) the model, because a module that is not loaded cannot be asked to
 * fetch anything.
 * @param {GraphModel} model
 * @param {{animate?: boolean, refit?: boolean}} [opts]
 * @returns {void}
 */
export function setMapModel(model, opts) {
  mapState.model = model;
  nextLayout(opts && opts.animate, opts && opts.refit);
}

/**
 * Edit-connections mode does not survive the overlay closing - it is a mode you
 * enter deliberately, and finding the map armed for editing on an open you made
 * for reading is a trap. Called by islands/map.js's destroy(), which is the one
 * place that knows the overlay went away.
 * @returns {void}
 */
export function forgetMapEditMode() { savedEditMode = false; }
