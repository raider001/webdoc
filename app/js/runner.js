// runner.js - the test runner's ENTRY POINT: open one, close one, and the
// shapes a run is stored in.
// ---------------------------------------------------------------------------
// The screen itself - the per-test checklist grid, the Pass/Fail toggles, the
// contenteditable response and notes fields, the progress counter and Save - is
// app/svelte/RunnerOverlay.svelte now. What is left here is the lifecycle the
// vanilla shell drives (main.js listens for `webdoc:run-test` and calls
// openRunner, authoring and the coverage view call closeRunner) plus the
// typedefs app/js/coverage.js reads a stored run through.
//
// The typedefs stay put deliberately. TestRunRecord and TestRunMeta describe the
// per-source sidecar's ON-DISK shape, which coverage.js and coverage-view.js
// both refer to as `import('./runner.js').…`; they are a contract about stored
// data, not about a screen, and moving them into a component would put a data
// format inside a view.
// ---------------------------------------------------------------------------
import { loadIslands } from './islands.js';

/** @typedef {import('./main.js').RunnerOpts} RunnerOpts */

/**
 * One step's live run state inside a test's working model: the definition
 * (action/expected, both Markdown source, carried over unchanged from the
 * TestCaseEntry) plus what the tester has recorded this run.
 * @typedef {Object} RunStep
 * @property {string} action - Markdown source
 * @property {string} expected - Markdown source
 * @property {string} actual - the tester's recorded response, as HTML
 * @property {boolean|null} pass - null when not yet recorded
 */

/**
 * One test case's working run state, pre-populated from its latest stored
 * result (if any) so a re-run starts where the last one left off. `dirty`
 * gates which tests Save actually rewrites - untouched tests keep whatever
 * result is already stored.
 * @typedef {Object} RunTest
 * @property {string} id
 * @property {string} name
 * @property {string[]} verifies - requirement/test ids this test verifies
 * @property {boolean} dirty
 * @property {string} notes - HTML
 * @property {RunStep[]} steps
 */

/**
 * Who ran a test and when.
 * @typedef {Object} TestRunMeta
 * @property {string} at - ISO timestamp
 * @property {string} by - tester name
 */

/**
 * One test's stored manual run outcome, keyed by test id inside a per-source
 * manual-results sidecar (CoverageResults.manual).
 * @typedef {Object} TestRunRecord
 * @property {TestRunMeta} run
 * @property {{step: string, response: string, pass: boolean|null}[]} steps
 * @property {string} report - HTML
 */

/**
 * The live run screen, or null when none is open.
 * @type {{destroy: () => void}|null}
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

/** Close and remove the run overlay, if one is open. @returns {void} */
export function closeRunner() {
  generation++;
  if (island) { island.destroy(); island = null; }
  document.body.classList.remove('is-running');
}

/**
 * Open the full-screen test-run overlay for a set of test cases.
 * @param {RunnerOpts} opts
 * @returns {void}
 */
export function openRunner(opts) {
  closeRunner();
  const mine = generation;
  // Set before the await, not after: it is what stops the document scrolling
  // behind the overlay, and the overlay is what the reader is about to look at.
  document.body.classList.add('is-running');
  loadIslands().then(islands => {
    if (mine !== generation) return;   // closed (or superseded) while the bundle was in flight
    island = islands.mountRunner(document.body, {
      tests: opts.tests || [],
      // The one caller (main.js) always supplies results; the fallback is
      // belt-and-braces for a caller that does not, and builds only the two maps
      // the runner touches.
      results: opts.results || /** @type {import('./coverage.js').CoverageResults} */ ({ auto: {}, manual: {} }),
      sources: opts.sources,
      onSaved: () => { if (typeof opts.onSaved === 'function') opts.onSaved(); },
      onClose: closeRunner,
    });
  });
}
