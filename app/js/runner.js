// runner.ts - the test runner's ENTRY POINT: open one, close one, and the
// shapes a run is stored in.
// ---------------------------------------------------------------------------
// The screen itself - the per-test checklist grid, the Pass/Fail toggles, the
// contenteditable response and notes fields, the progress counter and Save - is
// app/svelte/RunnerOverlay.svelte now. What is left here is the lifecycle the
// vanilla shell drives (main.js listens for `webdoc:run-test` and calls
// openRunner, authoring and the coverage view call closeRunner) plus the
// types app/js/coverage.js reads a stored run through.
//
// The type declarations stay put deliberately. TestRunRecord and TestRunMeta
// describe the per-source sidecar's ON-DISK shape, which coverage.ts and
// coverage-view.js both refer to as `import('./runner.js').…`; they are a
// contract about stored data, not about a screen, and moving them into a
// component would put a data format inside a view.
// ---------------------------------------------------------------------------
import { loadIslands } from './islands.js';
/**
 * The live run screen, or null when none is open.
 */
let island = null;
/**
 * Bumped by every open and every close. The bundle is fetched asynchronously, so
 * a reader who presses Run and immediately closes (or presses Run on a second
 * test) can have a mount in flight for a run that is already over; comparing the
 * token is how that mount knows to give up rather than putting an orphan overlay
 * on the page.
 */
let generation = 0;
/** Close and remove the run overlay, if one is open. */
export function closeRunner() {
    generation++;
    if (island) {
        island.destroy();
        island = null;
    }
    document.body.classList.remove('is-running');
}
/**
 * Open the full-screen test-run overlay for a set of test cases.
 */
export function openRunner(opts) {
    closeRunner();
    const mine = generation;
    // Set before the await, not after: it is what stops the document scrolling
    // behind the overlay, and the overlay is what the reader is about to look at.
    document.body.classList.add('is-running');
    loadIslands().then(islands => {
        if (mine !== generation)
            return; // closed (or superseded) while the bundle was in flight
        island = islands.mountRunner(document.body, {
            tests: opts.tests || [],
            // The one caller (main.js) always supplies results; the fallback is
            // belt-and-braces for a caller that does not, and builds only the two maps
            // the runner touches.
            results: opts.results || { auto: {}, manual: {} },
            sources: opts.sources,
            onSaved: () => { if (typeof opts.onSaved === 'function')
                opts.onSaved(); },
            onClose: closeRunner,
        });
    });
}
