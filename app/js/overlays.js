// overlays.ts - the two full-screen overlay HOSTS (#graphOverlay, #covOverlay),
// created once at boot, plus the small question-and-command surface the rest of
// the app uses to talk about them.
//
// WHY THIS EXISTS.
//
// Both hosts used to be created lazily, as a side effect of the module that
// fills them: #graphOverlay by setupGraphButton() in map-view.js, #covOverlay by
// setupCoverageView() in coverage-view.js. That was harmless only while those
// modules were imported eagerly at boot. The moment they become dynamic imports
// - which is the whole point of the lazy-import work - el('graphOverlay') is
// null until the reader first presses the Map button, and authoring.ts's three
// unguarded `!el('graphOverlay').hidden` reads become a TypeError on the first
// document create, save or delete. The map need never have been opened.
//
// So the HOST is separated from its CONTENTS. The host is a cheap empty div that
// exists from first paint; the expensive module that fills it loads on demand.
// That also makes both ids valid mount targets for later work without having to
// order anything against boot().
//
// The second job is to stop callers importing a 260-line module just to ask a
// yes/no question. `mapOpen()` replaces `!el('graphOverlay').hidden` at every
// call site, and `requestMapRebuild()` replaces a direct buildDocGraph() call -
// it loads map-view.js only when the map is actually open, so a reader who never
// opens the map never downloads the graph engine.
import { el } from './app-shell.js';
import { elem } from './dom.js';
let mapParts = null;
let covParts = null;
function makeHost(id, cls) {
    const stage = elem('div');
    const host = elem('div', { class: cls, id: id, hidden: true }, stage);
    document.body.appendChild(host);
    return { host: host, stage: stage };
}
/**
 * Create both overlay hosts. Called once from boot(), before anything can ask
 * about them. Idempotent, so a second call (a test, a hot reload) is harmless.
 */
export function ensureOverlayHosts() {
    if (!mapParts)
        mapParts = makeHost('graphOverlay', 'graph-overlay');
    if (!covParts)
        covParts = makeHost('covOverlay', 'graph-overlay cov-overlay');
}
function need(parts, which) {
    if (!parts)
        throw new Error('overlays: ' + which + ' host requested before ensureOverlayHosts() ran');
    return parts;
}
export function mapOverlay() { return need(mapParts, 'map'); }
export function coverageOverlay() { return need(covParts, 'coverage'); }
/**
 * Is the document map currently on screen? Safe before ensureOverlayHosts() has
 * run - it answers false rather than throwing, because "not open" is the honest
 * answer for an overlay that does not exist yet, and the callers are asking in
 * order to decide whether to bother doing more work.
 */
export function mapOpen() {
    const node = el('graphOverlay');
    return !!node && !node.hidden;
}
export function coverageOpen() {
    const node = el('covOverlay');
    return !!node && !node.hidden;
}
/**
 * Rebuild the document map, but only if it is actually open.
 *
 * This is the call authoring.ts and the change-watcher make after a write. It
 * loads map-view.js dynamically, so the graph engine is fetched only by a reader
 * who has opened the map - and a create/save/delete with the map closed costs
 * nothing and imports nothing.
 */
export async function requestMapRebuild() {
    if (!mapOpen())
        return;
    const mapView = await import('./map-view.js');
    await mapView.buildDocGraph(true); // keep the current view (the default), animate to the new layout
}
