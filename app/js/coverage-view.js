// coverage-view.js - the full-screen Test Coverage overlay's SHELL: open, close,
// and the exportable HTML report.
//
// Everything you can see inside the overlay - the requirement/test status graph,
// the legend filter, the detail panel with its steps, verifying-test linking and
// automated-test connection - is app/svelte/CoverageOverlay.svelte now, mounted
// into the stage host app/js/overlays.js created at boot. What is left here is
// the part that must NOT move.
//
// WHY exportReport() STAYS VANILLA. It calls app/js/report.js, which writes a
// self-contained HTML file: one document, no imports, opened later from a
// file:// URL on somebody else's machine with no server and no bundle anywhere
// near it. downloadFile() and isoDate() stay in app-shell.js for the same
// reason. Pulling any of that into the island would make a shareable artefact
// depend on a build output that is not shipped with it.
//
// The button is wired by main.js, not here: this module is fetched lazily on the
// first press, so the click that paid for the load is already over by the time
// setupCoverageView() runs, and main.js calls open() for it.
import { state, el, downloadFile, isoDate, app } from './app-shell.js';
import { requirementList, testList } from './requirements.js';
import { loadResults, computeCoverage, computeTestStatus, testsFor } from './coverage.js';
import { generateReportHtml } from './report.js';
import { coverageOverlay } from './overlays.js';
import { loadIslands } from './islands.js';
import { announce } from './announce.js';
/** @typedef {import('./requirements.js').RequirementEntry} RequirementEntry */
/** @typedef {import('./requirements.js').TestCaseEntry} TestCaseEntry */
/** @typedef {import('./coverage.js').CoverageResults} CoverageResults */
/** @typedef {import('./coverage.js').CoverageStatus} CoverageStatus */
/**
 * The single input object generateReportHtml() (report.js) takes to build the
 * whole standalone, shareable HTML test report; assembled once by exportReport().
 * @typedef {Object} TestReportData
 * @property {string} title
 * @property {string} generatedAt
 * @property {RequirementEntry[]} requirements
 * @property {TestCaseEntry[]} tests
 * @property {Map<string, CoverageStatus>} reqStatus
 * @property {Map<string, CoverageStatus>} testStatus
 * @property {({id:string} & import('./coverage.js').TestEvidence & {run: import('./runner.js').TestRunMeta|null})[]} detail
 */
/**
 * Set up the full-screen Test Coverage overlay: expose close() through the
 * shared `app` registry, and return the handle main.js drives the header button
 * with.
 * @returns {import('./map-view.js').OverlayHandle}
 */
export function setupCoverageView() {
    const btn = el('covBtn');
    // The host and its stage are created eagerly at boot by
    // overlays.ensureOverlayHosts(); this module only fills the stage. The class
    // is added here rather than there because it is this view's requirement: the
    // stage stops being the graph's own container (which sized itself) and becomes
    // the island's mount target, which has to be told to fill the overlay.
    const { host: overlay, stage } = coverageOverlay();
    stage.classList.add('cov-stage');
    /**
     * The mounted island, or null while the view is closed. Kept because
     * unmounting is what stops the graph's requestAnimationFrame loop and releases
     * window.__graph - detaching the DOM would not.
     * @type {{destroy: () => void}|null}
     */
    let island = null;
    /**
     * The last results the island loaded, mirrored here so exportReport() reports
     * on what the reader is actually looking at.
     * @type {CoverageResults}
     */
    let results = null;
    /** Close the coverage overlay. @returns {void} */
    const close = () => {
        if (overlay.hidden)
            return;
        overlay.hidden = true;
        btn.setAttribute('aria-pressed', 'false');
        if (island) {
            island.destroy();
            island = null;
        }
    };
    /** Open the coverage overlay, loading results before it mounts. @returns {Promise<void>} */
    const open = async () => {
        if (app.closeMapView)
            app.closeMapView(); // only one overlay view at a time
        overlay.hidden = false;
        btn.setAttribute('aria-pressed', 'true');
        // Loaded HERE rather than inside the component so the first frame is the
        // real graph, and so exportReport() has something to report on even if the
        // reader presses it before touching anything.
        results = await loadResults(state.site && state.site.sources);
        const islands = await loadIslands();
        // Two awaits is two chances for the reader to have closed it again.
        if (overlay.hidden)
            return;
        if (island)
            island.destroy();
        island = islands.mountCoverageOverlay(stage, {
            results: results,
            onResults: (r) => { results = r; },
            onExport: () => { exportReport(); },
            onClose: close,
        });
        announce('Opened the test coverage view. Click a requirement for its test report.');
    };
    /**
     * Build and download a self-contained, shareable Test Coverage Report.
     * @returns {Promise<void>}
     */
    async function exportReport() {
        const res = results || await loadResults(state.site && state.site.sources);
        const reqs = requirementList();
        const tests = testList();
        const now = new Date();
        const html = generateReportHtml({
            title: (state.site && state.site.siteTitle) || 'WebDocs',
            generatedAt: now.toLocaleString(),
            requirements: reqs,
            tests: tests,
            reqStatus: computeCoverage(reqs, res),
            testStatus: computeTestStatus(tests, res),
            detail: tests.map(t => {
                const m = res.manual[t.id];
                // run metadata (when / who) rides along with the evidence
                return Object.assign({ id: t.id }, testsFor(t.id, res), { run: (m && m.run) ? m.run : null });
            })
        });
        const base = ((state.site && state.site.siteTitle) || 'webdocs').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'webdocs';
        downloadFile(base + '-test-report-' + isoDate(now) + '.html', html, 'text/html');
        announce('Test report downloaded.');
    }
    app.closeCoverageView = close;
    // No Escape listener here any more. It used to be a permanent `document`
    // listener guarded by `!overlay.hidden`, doing two jobs (dismiss the report
    // panel, else close the view) and needing to know whether the panel was up.
    // CoverageOverlay.svelte owns both now, on a listener that exists only while
    // the overlay does - which is the same guard, expressed as a lifetime.
    return { open: open, close: close, toggle: () => (overlay.hidden ? open() : close()) };
}
