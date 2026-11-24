// requirements/store.ts - the shared in-memory index the requirements subsystem
// hangs off: the requirement + test record maps (populated from the server's
// coverage index), the per-document parsed block lists, the coverage-status map
// that colours badges, and the source->component lookup. Kept in one place so
// parse / render / the barrel share it WITHOUT an import cycle (only parse and
// render import this; it imports nothing). Extracted from requirements.js.
//
// WHY THIS FILE STAYS PUT (no move, no rename, no `.svelte.js`): app/index.html
// loads /js/main.js as a NATIVE es module, and this file is reachable from that
// graph through requirements.js / parse.js / render.js. Runes are a COMPILE-time
// transform - a `.svelte.js` file is not valid to a browser that never ran Vite
// over it - so nothing reachable from a native /js/ import may contain one.
// Hence the direction of the seam: this stays a plain module with a plain
// listener list, and the rune store (app/svelte/stores/coverage.svelte.js)
// subscribes to it from the compiled side. Vanilla pushes; Svelte listens.
// ---------------------------------------------------------------------------

import type { RequirementEntry, TestCaseEntry } from '../requirements.js';
import type { ReqOrTestBlock } from './parse.js';
import type { CoverageStatus } from '../coverage.js';

/** requirement id -> record */
export const index = new Map<string, RequirementEntry>();
/** test id -> record */
export const testIndex = new Map<string, TestCaseEntry>();
/** docId -> blocks (requirement group OR test case, in document order) */
export const groupsByDoc = new Map<string, ReqOrTestBlock[]>();

/** set by the app so badges colour by status */
let coverageStatus: Map<string, CoverageStatus> | Record<string, CoverageStatus> | null = null;
/** source name -> component id */
let componentBySource: Record<string, string> = {};

/**
 * Everyone who wants to know when the status map is REPLACED.
 *
 * The map is swapped wholesale (never mutated in place) by main.js and
 * coverage-view.js, so there is exactly one moment worth announcing and no need
 * for per-id granularity. A plain array of plain callbacks: see the header for
 * why this file cannot hold a rune.
 */
const statusListeners: (() => void)[] = [];

/**
 * Subscribe to coverage-status replacements.
 * @param fn - called AFTER the new map is in place, so a callback that
 *   immediately calls statusOf() sees the new values, never the old ones
 * @returns unsubscribe; safe to call more than once
 */
export function onStatusChange(fn: () => void): () => void {
  statusListeners.push(fn);
  return () => {
    const i = statusListeners.indexOf(fn);
    if (i >= 0) statusListeners.splice(i, 1);
  };
}

export function setCoverageStatus(m: Map<string, CoverageStatus> | Record<string, CoverageStatus> | null): void {
  coverageStatus = m;
  // Notify AFTER the swap, and defend the swap from its subscribers: a listener
  // that throws must not stop the remaining listeners running, and must not
  // propagate out of setCoverageStatus - its callers (a coverage refresh, a test
  // run finishing) would otherwise abort half-way through because of a rendering
  // bug. Iterated over a COPY because an unsubscribe from inside a callback would
  // otherwise shift the array underneath the loop and skip the next listener.
  statusListeners.slice().forEach(fn => {
    try { fn(); } catch (e) { /* one bad listener must not break a status update */ }
  });
}
/**
 * @param id - a requirement or test id
 * @returns null if no coverage status is set at all; undefined if it is set but
 *   has no entry for this id
 */
export function statusOf(id: string): CoverageStatus | null | undefined {
  if (!coverageStatus) return null;
  // Duck-typed so either shape works. Testing for `.get` narrows nothing for the
  // checker - the plain-object arm's string index signature makes `.get` look
  // like a CoverageStatus rather than a method, and the Map arm has no index
  // signature at all - so each branch has to say which arm it is standing on.
  return coverageStatus.get
    ? (coverageStatus as Map<string, CoverageStatus>).get(id)
    : (coverageStatus as Record<string, CoverageStatus>)[id];
}
/** @param map - source name -> component id */
export function setComponentBySource(map: Record<string, string>): void { componentBySource = map; }
/** @returns the component id, or undefined if the source is unknown */
export function componentOf(source: string): string | undefined { return componentBySource[source]; }
