// map-view.ts - the document-relationship "Map" overlay's SHELL: open, close,
// and the one fetch that feeds it.
//
// Everything you can see inside the overlay - the canvas scene, the zoom
// controls, the search box, the edge legend, the "Map by" dropdown, the access-
// group legend, the edit-connections toggle and its hint, the focus toggle, the
// minimap and the empty state - is app/svelte/MapOverlay.svelte now, mounted
// into the stage host app/js/overlays.js created at boot. What is left here is
// the part that must NOT move into the bundle.
//
// WHY THE FETCH STAYS OUT HERE. app/js/overlays.js's requestMapRebuild() is
// called by authoring.js on every create, save and delete and by main.js's
// four-second change poll, and its whole job is to decide - WITHOUT loading
// anything - whether a rebuild is worth paying for. It answers that by asking
// whether the overlay is open, and only then imports this module. Move the fetch
// inside the island and that decision would have to be made by code that is only
// reachable once the island has been downloaded, which is the wrong way round.
// So: the shell fetches and pushes; the island renders.
//
// The map and coverage views are both full-screen overlays; only one at a time -
// each registers its close() on the shared `app` registry (app.closeMapView /
// app.closeCoverageView) so the other overlay can dismiss it without a hard
// import. The graph MODEL (fetch/cache/invalidate) lives in ./graph-model.js so
// that callers who only need the document list never pull in the canvas renderer.
//
// This module no longer imports ./graph.js at all. The engine is reached through
// the island's own dynamic import (app/svelte/actions/graph.js), so the ~2,000
// lines of canvas renderer are fetched by the click that draws a graph and by
// nothing else.
import { mustEl, app } from './app-shell.js';
import { mapOverlay } from './overlays.js';
import { ensureGraphModel } from './graph-model.js';
import { loadIslands } from './islands.js';
import { announce } from './announce.js';
/**
 * The mounted island, or null while the map is closed. Kept because unmounting
 * is what stops the graph's requestAnimationFrame loop and releases
 * window.__graph - detaching the DOM would not.
 */
let island = null;
// (Re)build the document map. Restoring the current pan/zoom is the DEFAULT (so
// the view doesn't jump on an edit-connections change) and `refit` is the opt-out.
// Async: it fetches the server graph model (cached) before handing it over.
//
// It is safe to call with the overlay closed - the model simply lands in the
// island's store and seeds the next mount, which is exactly what open() below
// relies on.
/**
 * @param animate - animate nodes from their prior positions (tween) into the new layout
 * @param refit - fit fresh to the new layout frame instead of restoring the saved pan/zoom (used on a focus change)
 */
export async function buildDocGraph(animate, refit) {
    // Fetch the (cached) model BEFORE touching the live graph, so the current map
    // stays on-screen during the await. Destroying first and THEN awaiting left
    // the map blank for a frame -> the "flash" on create/delete/edit rebuilds.
    const model = await ensureGraphModel();
    const islands = await loadIslands();
    islands.setMapModel(model, { animate: !!animate, refit: !!refit });
}
/**
 * Set up the map overlay: expose close() through the shared `app` registry, and
 * return the handle main.js drives the header button with.
 */
export function setupGraphButton() {
    // mustEl, not el: #graphBtn and #content are both in main.ts's REQUIRED_IDS, so
    // a missing one is a broken template and says so here rather than three
    // dereferences later.
    const btn = mustEl('graphBtn');
    // The host is created eagerly at boot by overlays.ensureOverlayHosts(), not
    // here. This module may load long after boot (or never), and #graphOverlay has
    // to exist from first paint because authoring asks whether the map is open on
    // every create, save and delete.
    //
    // The class is added here rather than there because it is this view's
    // requirement: the stage used to BE the graph's own container (which sized
    // itself off `.graph-root`) and is now the island's mount target, which has to
    // be told to fill the overlay so the component's own `.graph-root` has a
    // height to measure.
    const { host: overlay, stage } = mapOverlay();
    stage.classList.add('map-stage');
    /** Close the map overlay. */
    const close = () => {
        if (overlay.hidden)
            return;
        overlay.hidden = true;
        btn.setAttribute('aria-pressed', 'false');
        if (island) {
            island.destroy();
            island = null;
        } // stops the rAF loop and releases window.__graph
        mustEl('content').focus({ preventScroll: true });
    };
    /** Open the map overlay, loading the graph model before it mounts. */
    const open = async () => {
        if (app.closeCoverageView)
            app.closeCoverageView(); // only one overlay view at a time
        overlay.hidden = false;
        btn.setAttribute('aria-pressed', 'true');
        // Seeded HERE rather than inside the component so the first frame is the
        // real graph rather than an empty stage that fills in. The overlay is
        // already revealed, so the stage has a height by the time the component
        // measures it - a graph mounted into a hidden box fits itself to nothing.
        await buildDocGraph();
        const islands = await loadIslands();
        // Two awaits is two chances for the reader to have closed it again.
        if (overlay.hidden)
            return;
        if (island)
            island.destroy();
        island = islands.mountMapOverlay(stage, {
            onClose: close,
            onRebuild: buildDocGraph,
        });
        announce('Opened the document map. Click a document to select it; double-click to open it. Escape closes.');
    };
    app.closeMapView = close;
    // The BUTTON is wired by main.js, NOT here. This module is fetched lazily, on
    // the first press, so the click that paid for the load has already been and
    // gone by the time this runs - main.js calls open() for it. Attaching a second
    // listener here would make every later click toggle twice.
    //
    // No Escape listener here any more either. It used to be a permanent
    // `document` listener guarded by `!overlay.hidden`, doing two jobs (leave the
    // focused node, else close the view). MapOverlay.svelte owns both now, on a
    // listener that exists only while the overlay does - the same guard, expressed
    // as a lifetime.
    return { open: open, close: close, toggle: () => (overlay.hidden ? open() : close()) };
}
