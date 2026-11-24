// islands/coverage.ts - the two full-screen test surfaces: the coverage overlay
// and the test runner.
//
// BOTH RETURN A HANDLE, and both callers must keep it. These are the opposite of
// islands/tree.ts's mount-once islands: a coverage view that stays mounted while
// hidden keeps a requestAnimationFrame loop alive and keeps window.__graph
// pointing at a graph nobody can see, which is precisely the "two canvas views
// at once" failure tests/test_map_ui.py exists to catch. So coverage-view.js
// mounts on open and destroys on close, and runner.js does the same around a run.
//
// THE TWO TARGETS DIFFER, on purpose:
//
//   - The coverage overlay goes into the STAGE div that app/js/overlays.js
//     created inside #covOverlay at boot. That host exists from first paint
//     precisely so the module filling it can load late, and reusing it means
//     this island needs no ordering against boot() at all.
//   - The runner has no host, so it gets one: a `.wd-mounted` (display:contents)
//     div appended to <body>, removed again by destroy. `.runner-overlay` is
//     position:fixed, so a wrapper that took up space would be wrong; one that
//     takes up none lays out exactly as the hand-appended overlay did.
import { mount, unmount } from 'svelte';
import CoverageOverlay from '../CoverageOverlay.svelte';
import type { CoverageResults } from '/js/coverage.js';

export interface CoverageOverlayOpts {
  /** already loaded by the caller, so the first frame is the real graph */
  results: CoverageResults;
  /** a later reload, handed back for exportReport() */
  onResults: (r: CoverageResults) => void;
  /** build and download the standalone HTML report */
  onExport: () => void;
  /** close the whole overlay (Escape, or a link that routes away) */
  onClose: () => void;
}

/**
 * The Test Coverage view.
 * @param target - the stage div inside #covOverlay
 */
export function mountCoverageOverlay(target: Element, opts: CoverageOverlayOpts): { destroy: () => void } {
  const instance = mount(CoverageOverlay, {
    target: target,
    props: {
      results: opts.results,
      onResults: opts.onResults,
      onExport: opts.onExport,
      onClose: opts.onClose,
    },
  });
  return { destroy: () => unmount(instance) };
}

export async function loadRunner() { return import('./runner.js'); }
