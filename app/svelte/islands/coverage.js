// islands/coverage.js - the two full-screen test surfaces: the coverage overlay
// and the test runner.
//
// BOTH RETURN A HANDLE, and both callers must keep it. These are the opposite of
// islands/tree.js's mount-once islands: a coverage view that stays mounted while
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
import RunnerOverlay from '../RunnerOverlay.svelte';

/** @typedef {import('/js/coverage.js').CoverageResults} CoverageResults */

/**
 * @typedef {Object} CoverageOverlayOpts
 * @property {CoverageResults} results - already loaded by the caller, so the first frame is the real graph
 * @property {(r: CoverageResults) => void} onResults - a later reload, handed back for exportReport()
 * @property {() => void} onExport - build and download the standalone HTML report
 * @property {() => void} onClose - close the whole overlay (Escape, or a link that routes away)
 */

/**
 * The Test Coverage view.
 * @param {Element} target - the stage div inside #covOverlay
 * @param {CoverageOverlayOpts} opts
 * @returns {{destroy: () => void}}
 */
export function mountCoverageOverlay(target, opts) {
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

/**
 * @typedef {Object} RunnerOpts
 * @property {import('/js/requirements.js').TestCaseEntry[]} tests
 * @property {CoverageResults} results
 * @property {import('/js/catalog.js').SourceConfig[]} sources
 * @property {() => void} onSaved
 * @property {() => void} onClose
 */

/**
 * The full-screen test runner.
 * @param {Element} target - <body>; the overlay is fixed-position, so this is
 *   only about where the host node lives
 * @param {RunnerOpts} opts
 * @returns {{destroy: () => void}}
 */
export function mountRunner(target, opts) {
  const node = document.createElement('div');
  node.className = 'wd-mounted';
  target.appendChild(node);
  const instance = mount(RunnerOverlay, {
    target: node,
    props: {
      tests: opts.tests,
      results: opts.results,
      sources: opts.sources,
      onSaved: opts.onSaved,
      onClose: opts.onClose,
    },
  });
  // The code that created the node is the code that removes it - the discipline
  // app/js/islands.js exists to impose.
  return { destroy: () => { unmount(instance); node.remove(); } };
}
