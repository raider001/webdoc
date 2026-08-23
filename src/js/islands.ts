// islands.ts - the ONLY seam between the hand-written vanilla shell and the
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

import type { TocEntry } from './numbering.js';
import type { ReqGroupBlock, TestCaseDocBlock } from './requirements/parse.js';
import type { CoverageResults } from './coverage.js';
import type { TestCaseEntry } from './requirements.js';
import type { SourceConfig } from './catalog.js';
import type { GraphModel } from './graph-model.js';

export type IslandProps = Record<string, unknown>;

/**
 * The bundle's export surface, as built from app/svelte/entry.js.
 *
 * `mount`'s component parameter is `unknown` rather than a Svelte component
 * type: the component values come out of the bundle by name at run time (see
 * mountIsland), and 'svelte' is a build-time specifier this file must not
 * resolve, so there is no honest type to name here.
 */
export interface IslandModule {
  mount: (component: unknown, opts: { target: Element, props?: IslandProps }) => Record<string, unknown>;
  unmount: (instance: Record<string, unknown>) => void;
  mountDocTree: (target: Element, onSelect: (id: string) => void) => void;
  mountSearchHits: (target: Element, onSelect: (id: string) => void) => void;
  /** highlight and reveal a document in the tree */
  setActive: (id: string | null) => void;
  /** refetch open levels, preserving expansion */
  invalidateTree: () => void;
  beginSearch: (query: string) => void;
  showHits: (hits: { docId: string, title: string, snippet?: string, locked?: boolean }[]) => void;
  /** apply pending rune updates to the DOM NOW */
  flushSync: () => void;
  mountToc: (target: Element, contentEl: HTMLElement) => void;
  mountCrumbs: (target: Element) => void;
  mountFooter: (prevTarget: Element, nextTarget: Element) => void;
  setCrumbs: (docId: string) => void;
  setToc: (toc: TocEntry[]) => void;
  setFootLinks: (assumes: string[], next: string[]) => void;
  /** the full-screen wall; removes itself before reporting success */
  mountSignInWall: (target: Element, opts: { onSignedIn: () => void }) => void;
  /** the header button's contents only */
  mountAccountButton: (target: Element) => void;
  openAccountPanel: (opts: { onSignOut: () => void }) => void;
  openAdminPanel: () => void;
  mountRestrictedPage: (target: Element, docId: string, detail: Record<string, unknown>, opts: { onSignIn: () => void }) => { destroy: () => void };
  mountRestrictedSection: (target: Element, spec: Record<string, unknown>) => { destroy: () => void };
  mountGroupChip: (target: Element, name: string, opts?: { small?: boolean, title?: string }) => { destroy: () => void };
  /** begin mirroring requirements/store.js's coverage-status changes into the bundle; idempotent, and safe to call before anything status-coloured is mounted */
  startCoverageSync: () => void;
  /** one requirement group, into a `.wd-mounted` host inside the article */
  mountReqTable: (target: Element, block: ReqGroupBlock) => { destroy: () => void };
  /** one test case, into a `.wd-mounted` host inside the article */
  mountTestCase: (target: Element, block: TestCaseDocBlock) => { destroy: () => void };
  /** the Test Coverage view, into #covOverlay's stage; destroy it on close so the canvas rAF loop stops */
  mountCoverageOverlay: (target: Element, opts: { results: CoverageResults, onResults: (r: CoverageResults) => void, onExport: () => void, onClose: () => void }) => { destroy: () => void };
  /** the full-screen test runner, into a `.wd-mounted` host it appends to the target */
  mountRunner: (target: Element, opts: { tests: TestCaseEntry[], results: CoverageResults, sources: SourceConfig[], onSaved: () => void, onClose: () => void }) => { destroy: () => void };
  /** the document map, into #graphOverlay's stage; destroy it on close so the canvas rAF loop stops and window.__graph is released */
  mountMapOverlay: (target: Element, opts: { onClose: () => void, onRebuild: (animate?: boolean) => Promise<void> }) => { destroy: () => void };
  /** hand the map a freshly fetched server graph model and relayout; safe before the overlay is mounted, which is how the first open seeds it */
  setMapModel: (model: GraphModel, opts?: { animate?: boolean, refit?: boolean }) => void;
}

// The served path of the compiled bundle. Exactly one file in the repository
// knows this, which is what makes renaming or emergency-reverting it a one-file
// change. Kept as a named constant so it is greppable from the build config.
const BUNDLE_URL = '/build/islands.js';

let pending: Promise<IslandModule> | null = null;
/**
 * The RESOLVED bundle, once it has landed - so a synchronous caller can ask
 * whether it is already here. See loadedIslands() for who needs that and why.
 */
let loaded: IslandModule | null = null;

/**
 * Load (once) and return the compiled island bundle. Concurrent callers share
 * one in-flight promise, so two islands mounting in the same frame cannot each
 * trigger a fetch.
 */
export function loadIslands(): Promise<IslandModule> {
  // Held in a variable on purpose. The specifier is a served URL, not a module
  // either the type-checker or a bundler should resolve: app/build/islands.js is
  // a build OUTPUT, and treating it as an input would make the build depend on
  // its own result. A non-literal specifier states that honestly - the module
  // shape is asserted below because it genuinely cannot be checked from here,
  // and app/svelte/entry.js is the file that has to keep the promise.
  if (!pending) {
    const url = BUNDLE_URL;
    pending = import(/* @vite-ignore */ url) as Promise<IslandModule>;
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
 * The escape hatch for a SYNCHRONOUS render path. reader.ts's renderDoc is
 * synchronous from end to end and main.ts sets body[data-app-ready="1"] the
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
 */
export function loadedIslands(): IslandModule | null { return loaded; }

/**
 * Mount a component from the bundle into `target`, returning a teardown handle.
 * `name` is an export name from app/svelte/entry.js.
 *
 * Always keep the handle and call destroy() when the shell removes `target`.
 * A component mounted into a node the shell later clears with textContent = ''
 * is not destroyed by that clear: its effects keep running against detached
 * nodes, which is the classic way an island turns into a leak.
 */
export async function mountIsland(name: string, target: Element, props?: IslandProps): Promise<{ destroy: () => void }> {
  const mod = await loadIslands();
  // The components are looked up BY NAME, so this one read has to see the bundle
  // as the open bag of exports it is - IslandModule names only the calls the
  // shell makes, never the component exports themselves.
  const Component = (mod as unknown as Record<string, unknown>)[name];
  if (!Component) throw new Error('islands: no component exported as "' + name + '"');
  const instance = mod.mount(Component, { target: target, props: props || {} });
  return { destroy: () => mod.unmount(instance) };
}
