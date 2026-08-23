// map.svelte.ts - the document map's own state.
//
// WHY A STORE RATHER THAN COMPONENT STATE. MapOverlay.svelte is mounted when the
// reader opens the map and UNMOUNTED when they close it - the same discipline
// islands/coverage.ts imposes on the coverage view, and for the same reason: a
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
// The `.svelte.ts` extension is required - it is what tells the compiler to
// process runes in a plain module rather than treat $state as an undefined name.
import type { GraphModel } from '/js/graph-model.js';
import type { GraphChangeEvent } from '/js/graph.js';

/** A pan/zoom: the engine's own transform, as getTransform() hands it back. */
export interface MapTransform {
  tx: number;
  ty: number;
  k: number;
}

export interface MapState {
  /** the server graph, fetched by map-view.js; null until the first open */
  model: GraphModel | null;
  /**
   * the LAYOUT token: bumped for anything the live instance cannot become (a new
   * model, a new "Map by" mode, a focus change), and read by nothing except the
   * {#key} that rebuilds the canvas
   */
  version: number;
  /** which connection type drives the tree layout: 'all' | 'recnext' | 'prereq' */
  mapMode: string;
  /** clicking a node centres the map on it instead of routing to it */
  focusMode: boolean;
  /** the radial-focus centre, or null for the hierarchy */
  focusId: string | null;
}

export const mapState: MapState = $state({
  model: null,
  version: 0,
  mapMode: 'all',
  focusMode: false,
  focusId: null,
});

/**
 * The last pan/zoom, restored on the next build so neither a rebuild nor a
 * close-and-reopen moves the view under the reader.
 */
let savedTransform: MapTransform | null = null;
/**
 * Where every node sat in the OUTGOING layout, so the renderer can tween each
 * one into its new place. Null until a controller has been harvested.
 */
let savedPositions: Map<string, { x: number; y: number }> | null = null;
let savedEditMode = false;
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
 */
let savedHiddenGroups: string[] = [];

/** Tween the next build from savedPositions. Set by nextLayout(), read by mapBuildSeeds(). */
let animate = false;
/** Fit the next build fresh instead of restoring savedTransform (a focus change reframes). */
let refit = false;

/**
 * Everything a new controller needs in order to open exactly where the old one
 * left off. Built fresh on every call so the caller may keep it.
 */
export interface MapBuildSeeds {
  /** null means "fit to the new frame" */
  initialTransform: MapTransform | null;
  /** null means "no tween" */
  animateFrom: Map<string, { x: number; y: number }> | null;
  editMode: boolean;
  connector: string;
  /** still an array; the caller makes the Set the engine wants */
  hiddenGroups: string[];
}

export function mapBuildSeeds(): MapBuildSeeds {
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
 */
export function rememberMapView(
  transform: MapTransform,
  positions: Map<string, { x: number; y: number }>,
  editState: GraphChangeEvent,
): void {
  savedTransform = transform;
  savedPositions = positions;
  savedEditMode = editState.editMode;
  savedConnector = editState.connector;
  savedHiddenGroups = Array.from(editState.hiddenGroups);
}

/**
 * Ask for a new layout: the live instance cannot become it, so the {#key} block
 * replaces the whole controller.
 * @param withTween - animate nodes from their previous positions
 * @param reframe - fit fresh instead of restoring the saved pan/zoom
 */
export function nextLayout(withTween?: boolean, reframe?: boolean): void {
  animate = !!withTween;
  refit = !!reframe;
  mapState.version++;
}

/**
 * Replace the server graph model and relayout. The vanilla shell's only way in:
 * app/js/map-view.js fetches (and app/js/overlays.js's requestMapRebuild
 * re-fetches) the model, because a module that is not loaded cannot be asked to
 * fetch anything.
 */
export function setMapModel(model: GraphModel, opts?: { animate?: boolean; refit?: boolean }): void {
  mapState.model = model;
  nextLayout(opts && opts.animate, opts && opts.refit);
}

/**
 * Edit-connections mode does not survive the overlay closing - it is a mode you
 * enter deliberately, and finding the map armed for editing on an open you made
 * for reading is a trap. Called by islands/map.ts's destroy(), which is the one
 * place that knows the overlay went away.
 */
export function forgetMapEditMode(): void { savedEditMode = false; }
