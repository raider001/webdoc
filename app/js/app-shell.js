// app-shell.js - the shared handles the app's feature modules (reader, map,
// coverage, authoring) hang off. It owns nothing but state + tiny helpers + a
// service registry; main.js does all the wiring. Keeping these here (instead of in
// main.js) lets a feature module import them WITHOUT importing main.js - so the
// modules never form an import cycle with the bootstrap.
/** @typedef {import('./catalog.js').Doc} Doc */
/**
 * The single shared app state (discovery result + current doc + scroll-spy
 * handle), kept here (not in main.js) so a feature module can read/write it
 * without importing main.js.
 * @typedef {Object} AppState
 * @property {Object<string, *>|null} site - parsed site.json ({siteTitle, defaultDoc, theme, sources, plugins, ...})
 * @property {Doc[]} docs - deliberately empty under the lazy server-backed architecture; byId is the real per-doc cache
 * @property {Map<string, Doc>} byId - docs seen so far, keyed by id - stubs from docFromId and/or fully loaded via catalog.loadDoc
 * @property {Doc|null} current - the doc currently routed/displayed
 * @property {*} spy - reserved for a scroll-spy handle; not assigned anywhere in the current code (reader.js keeps its own module-local IntersectionObserver instead)
 */
/** @type {AppState} */
export const state = { site: null, docs: [], byId: new Map(), current: null, spy: null };
/**
 * @param {string} id
 * @returns {HTMLElement|null}
 */
export const el = id => document.getElementById(id);
/**
 * A display title derived from a doc id's last segment (footer + new-doc
 * fallback, used when the full title isn't in the sparse client cache).
 * @param {string} id
 * @returns {string}
 */
export function titleFromId(id) {
    const base = String(id).split('/').pop().replace(/[-_]+/g, ' ');
    return base.replace(/\b\w/g, c => c.toUpperCase());
}
/**
 * The document to show when no (or an unknown) id is routed. state.docs is
 * empty under lazy boot, so a configured defaultDoc is what actually resolves.
 * @returns {string|undefined}
 */
export function defaultId() {
    return (state.site && state.site.defaultDoc) || (state.docs[0] && state.docs[0].id);
}
/**
 * Build a doc stub {id, source, rel, url, name} from an id, following the
 * /docs/<source>/<rel>.md URL convention the server serves, so the router can
 * loadDoc it on demand (a 404 is the not-found signal).
 * @param {string} id
 * @returns {Doc|null}
 */
export function docFromId(id) {
    const slash = String(id).indexOf('/');
    if (slash < 0)
        return null;
    const source = id.slice(0, slash), rel = id.slice(slash + 1) + '.md';
    const url = '/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/');
    return { id: id, source: source, rel: rel, url: url, name: id.split('/').pop() + '.md' };
}
/**
 * Resolve an id to a cached doc, or a fresh stub (cached for reuse). Shared by
 * the router (route) and authoring (deleteDocFlow).
 * @param {string} id
 * @returns {Doc|null|undefined}
 */
export function getDoc(id) {
    let d = state.byId.get(id);
    if (!d && id) {
        d = docFromId(id);
        if (d)
            state.byId.set(id, d);
    }
    return d;
}
/**
 * Download a string as a file (self-contained report), no server round-trip.
 * @param {string} filename
 * @param {string} text
 * @param {string} [mime]
 * @returns {void}
 */
export function downloadFile(filename, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/**
 * @param {Date} d
 * @returns {string}
 */
export function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
/**
 * Service registry: cross-cutting functions the modules call each other
 * through, set by main.js at boot (and by authoring.js/map-view.js/
 * coverage-view.js themselves on first use). Using a shared object (not
 * direct imports) is what keeps the feature modules acyclic.
 * @typedef {Object} AppRegistry
 * @property {(id: string) => void} [navigate] - route to a document
 * @property {(msg: string) => void} [showError] - show an error in place of the document view
 * @property {() => void} [closeDrawer] - close the mobile nav drawer, if open
 * @property {() => void} [closeMapView] - close the map overlay, if open
 * @property {() => void} [closeCoverageView] - close the coverage overlay, if open
 * @property {(testId: string, reqId: string) => Promise<boolean>} [linkTestToRequirement] - add a test's `verifies` connection
 * @property {(testId: string, reqId: string) => Promise<boolean>} [unlinkTestFromRequirement] - remove a test's `verifies` connection
 * @property {(fromId: string, toId: string, field: ('assumes'|'next'), action: ('add'|'remove')) => Promise<boolean>} [editDocRelation] - edit a doc's assumes/next list
 * @property {(id: string, opts?: {rebuildMap?: boolean}) => Promise<void>} [deleteDocFlow] - confirm + delete a document
 * @property {(docId: string) => Promise<void>} [updateDocActions] - show/hide Edit and Delete for what this account may do to this document
 * @property {(id: string|null) => void} [setTreeActive] - highlight and reveal a document in the drawer tree
 * @property {() => void} [invalidateTree] - refetch the drawer tree's open levels, preserving expansion
 * @property {(docId: string, toc: import('./numbering.js').TocEntry[], assumes: string[], next: string[]) => void} [setDocChrome] - push breadcrumb/TOC/footer into the island store and flush
 * @property {(host: Element, destroy: () => void) => void} [registerMounted] - record a component mounted inside the article so the next navigation destroys it
 */
/** @type {AppRegistry} */
export const app = {};
