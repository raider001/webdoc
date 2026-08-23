// app-shell.ts - the shared handles the app's feature modules (reader, map,
// coverage, authoring) hang off. It owns nothing but state + tiny helpers + a
// service registry; main.ts does all the wiring. Keeping these here (instead of in
// main.ts) lets a feature module import them WITHOUT importing main.ts - so the
// modules never form an import cycle with the bootstrap.
export const state = { site: null, docs: [], byId: new Map(), current: null, spy: null };
export const el = (id) => document.getElementById(id);
/**
 * el() for an id the shell CONTRACTUALLY has - every id in main.ts's REQUIRED_IDS
 * (asserted once at boot by assertShellIds) plus the two overlay hosts
 * (assertOverlayIds). Returns a plain HTMLElement, so the ~45 call sites that
 * already relied on that invariant can stop re-stating it.
 *
 * It throws rather than returning null because that is what the code did anyway:
 * `el('brand').textContent = ...` on a missing id threw "Cannot read properties of
 * null" three modules from the cause. Same failure, named - which is the whole
 * point of the shell contract. Use el() (and branch) for genuinely optional
 * elements like #toc; use this one only where a missing element is a broken
 * template.
 */
export function mustEl(id) {
    const node = document.getElementById(id);
    if (!node) {
        const err = new Error('Required element #' + id + ' is missing from the page.');
        err.name = 'ShellTemplateError'; // same name assertShellIds uses, so boot's catch reads alike
        throw err;
    }
    return node;
}
/**
 * A display title derived from a doc id's last segment (footer + new-doc
 * fallback, used when the full title isn't in the sparse client cache).
 */
export function titleFromId(id) {
    // split() always yields at least one segment, so the last one is a string -
    // indexing it says that in a way the compiler can see, where .pop() cannot.
    const segments = String(id).split('/');
    const base = segments[segments.length - 1].replace(/[-_]+/g, ' ');
    return base.replace(/\b\w/g, c => c.toUpperCase());
}
/**
 * The document to show when no (or an unknown) id is routed. state.docs is
 * empty under lazy boot, so a configured defaultDoc is what actually resolves.
 */
export function defaultId() {
    return (state.site && state.site.defaultDoc) || (state.docs[0] && state.docs[0].id);
}
/**
 * Build a doc stub {id, source, rel, url, name} from an id, following the
 * /docs/<source>/<rel>.md URL convention the server serves, so the router can
 * loadDoc it on demand (a 404 is the not-found signal).
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
 */
export function getDoc(id) {
    // Both halves of the return type in one binding: `undefined` from the Map miss,
    // `null` from a docFromId that could not split an id.
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
export function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
export const app = {};
