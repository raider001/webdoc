// islands.js - the ONLY seam between the hand-written vanilla shell and the
// compiled Svelte bundle. Nothing else in app/js/ may import /build/islands.js.
//
// Why a seam at all, rather than importing the bundle where it is needed:
//   - It is loaded LAZILY, on first use. A reader who never opens the drawer,
//     the map or the editor never downloads the framework at all, so the shell's
//     cold-start cost is unchanged for the most common visit.
//   - It is the one place that knows the built file's path. When the bundle is
//     renamed, split or (in an emergency) reverted, exactly one file changes.
//   - It gives every island the same mount/unmount discipline, so a component
//     mounted into a DOM node the shell owns is always torn down again by the
//     same code path that created it.
//
// The bundle re-exports Svelte's own mount/unmount rather than this module
// importing 'svelte' directly: the specifier 'svelte' is a BUILD-time name that
// no browser can resolve, and keeping it inside the compiled artifact is what
// lets app/js/ stay plain ES modules the browser loads natively.

/** @typedef {Record<string, unknown>} IslandProps */

/**
 * The bundle's export surface, as built from app/svelte/entry.js.
 * @typedef {Object} IslandModule
 * @property {(component: *, opts: {target: Element, props?: IslandProps}) => Record<string, unknown>} mount
 * @property {(instance: Record<string, unknown>) => void} unmount
 * @property {(target: Element, onSelect: (id: string) => void) => void} mountDocTree
 * @property {(target: Element, onSelect: (id: string) => void) => void} mountSearchHits
 * @property {(id: string|null) => void} setActive - highlight and reveal a document in the tree
 * @property {() => void} invalidateTree - refetch open levels, preserving expansion
 * @property {(query: string) => void} beginSearch
 * @property {(hits: {docId: string, title: string, snippet?: string, locked?: boolean}[]) => void} showHits
 * @property {() => void} flushSync - apply pending rune updates to the DOM NOW
 * @property {(target: Element, contentEl: HTMLElement) => void} mountToc
 * @property {(target: Element) => void} mountCrumbs
 * @property {(prevTarget: Element, nextTarget: Element) => void} mountFooter
 * @property {(docId: string) => void} setCrumbs
 * @property {(toc: import('./numbering.js').TocEntry[]) => void} setToc
 * @property {(assumes: string[], next: string[]) => void} setFootLinks
 * @property {(target: Element, opts: {onSignedIn: () => void}) => void} mountSignInWall - the full-screen wall; removes itself before reporting success
 * @property {(target: Element) => void} mountAccountButton - the header button's contents only
 * @property {(opts: {onSignOut: () => void}) => void} openAccountPanel
 * @property {() => void} openAdminPanel
 * @property {(target: Element, docId: string, detail: Object<string, *>, opts: {onSignIn: () => void}) => {destroy: () => void}} mountRestrictedPage
 * @property {(target: Element, spec: Object<string, *>) => {destroy: () => void}} mountRestrictedSection
 * @property {(target: Element, name: string, opts?: {small?: boolean, title?: string}) => {destroy: () => void}} mountGroupChip
 * @property {() => void} startCoverageSync - begin mirroring requirements/store.js's coverage-status changes into the bundle; idempotent, and safe to call before anything status-coloured is mounted
 * @property {(target: Element, block: import('./requirements/parse.js').ReqGroupBlock) => {destroy: () => void}} mountReqTable - one requirement group, into a `.wd-mounted` host inside the article
 * @property {(target: Element, block: import('./requirements/parse.js').TestCaseDocBlock) => {destroy: () => void}} mountTestCase - one test case, into a `.wd-mounted` host inside the article
 * @property {(target: Element, opts: {results: import('./coverage.js').CoverageResults, onResults: (r: import('./coverage.js').CoverageResults) => void, onExport: () => void, onClose: () => void}) => {destroy: () => void}} mountCoverageOverlay - the Test Coverage view, into #covOverlay's stage; destroy it on close so the canvas rAF loop stops
 * @property {(target: Element, opts: {tests: import('./requirements.js').TestCaseEntry[], results: import('./coverage.js').CoverageResults, sources: import('./catalog.js').SourceConfig[], onSaved: () => void, onClose: () => void}) => {destroy: () => void}} mountRunner - the full-screen test runner, into a `.wd-mounted` host it appends to the target
 * @property {(target: Element, opts: {onClose: () => void, onRebuild: (animate?: boolean) => Promise<void>}) => {destroy: () => void}} mountMapOverlay - the document map, into #graphOverlay's stage; destroy it on close so the canvas rAF loop stops and window.__graph is released
 * @property {(model: import('./graph-model.js').GraphModel, opts?: {animate?: boolean, refit?: boolean}) => void} setMapModel - hand the map a freshly fetched server graph model and relayout; safe before the overlay is mounted, which is how the first open seeds it
 */

// The served path of the compiled bundle. Exactly one file in the repository
// knows this, which is what makes renaming or emergency-reverting it a one-file
// change. Kept as a named constant so it is greppable from the build config.
const BUNDLE_URL = '/build/islands.js';

/** @type {Promise<IslandModule>|null} */
let pending = null;
/**
 * The RESOLVED bundle, once it has landed - so a synchronous caller can ask
 * whether it is already here. See loadedIslands() for who needs that and why.
 * @type {IslandModule|null}
 */
let loaded = null;

/**
 * Load (once) and return the compiled island bundle. Concurrent callers share
 * one in-flight promise, so two islands mounting in the same frame cannot each
 * trigger a fetch.
 * @returns {Promise<IslandModule>}
 */
export function loadIslands() {
  // Held in a variable on purpose. The specifier is a served URL, not a module
  // either the type-checker or a bundler should resolve: app/build/islands.js is
  // a build OUTPUT, and treating it as an input would make the build depend on
  // its own result. A non-literal specifier states that honestly - the module
  // shape is asserted below because it genuinely cannot be checked from here,
  // and app/svelte/entry.js is the file that has to keep the promise.
  if (!pending) {
    const url = BUNDLE_URL;
    pending = /** @type {Promise<IslandModule>} */ (import(/* @vite-ignore */ url));
    // Remember the resolved module for loadedIslands(). The rejection arm is
    // present only so this derived promise is HANDLED: every real caller awaits
    // `pending` itself and reports the failure there, and an unhandled rejection
    // here would report the same failure a second time, with no stack worth
    // reading.
    pending.then(mod => { loaded = mod; }, () => { /* reported by the awaiting caller */ });
  }
  return pending;
}

/**
 * The bundle IF it is already loaded, else null. NEVER loads it.
 *
 * The escape hatch for a SYNCHRONOUS render path. reader.js's renderDoc is
 * synchronous from end to end and main.js sets body[data-app-ready="1"] the
 * moment route() returns; a deep link (`#/doc?req=<ID>`) then looks its target
 * up by element id inside a single requestAnimationFrame. Anything mounted a
 * microtask later has missed that frame, and the deep link fails silently with
 * nothing logged. So requirements/render.js asks this first and mounts inline
 * when it can - which is the normal case, because boot() awaits
 * mountShellIslands() long before the first document is routed to.
 *
 * The asynchronous path still exists for the cold case (an early render, a test
 * harness): callers fall back to loadIslands().then(...) and accept that a deep
 * link into that one render may not scroll.
 * @returns {IslandModule|null}
 */
export function loadedIslands() { return loaded; }

/**
 * Mount a component from the bundle into `target`, returning a teardown handle.
 *
 * Always keep the handle and call destroy() when the shell removes `target`.
 * A component mounted into a node the shell later clears with textContent = ''
 * is not destroyed by that clear: its effects keep running against detached
 * nodes, which is the classic way an island turns into a leak.
 * @param {string} name - an export name from app/svelte/entry.js
 * @param {Element} target
 * @param {IslandProps} [props]
 * @returns {Promise<{destroy: () => void}>}
 */
export async function mountIsland(name, target, props) {
  const mod = await loadIslands();
  const Component = /** @type {Record<string, *>} */ (mod)[name];
  if (!Component) throw new Error('islands: no component exported as "' + name + '"');
  const instance = mod.mount(Component, { target: target, props: props || {} });
  return { destroy: () => mod.unmount(instance) };
}
