import type { SourceConfig } from './catalog.js';
import type { RequirementEntry, TestCaseEntry } from './requirements.js';
import type { TestRunMeta } from './runner.js';
/**
 * One recorded automated-test result flowing into CoverageResults.auto, keyed
 * by requirement/test id.
 */
export interface AutoResultEntry {
    name: string;
    pass: boolean;
    message: string;
}
/**
 * One xUnit <testcase> discovered from any configured/scanned/pasted xUnit XML,
 * keyed by classname+name; the searchable catalog entries a requirement/test can
 * be manually connected to.
 */
export interface AutoTestCatalogEntry {
    key: string;
    suite: string;
    classname: string;
    name: string;
    pass: boolean;
    message: string;
}
/**
 * A minimal reference to one automated testcase - either a full
 * AutoTestCatalogEntry (from the catalog) or a stored auto-link entry; only
 * classname+name identify it (suite is carried along when known).
 */
export interface AutoTestRef {
    suite?: string;
    classname: string;
    name: string;
}
/**
 * The per-source automated-test-connections store (GET/PUT /api/auto/<name>):
 * remembered external xUnit URLs plus the user's manual id -> testcase links.
 */
export interface AutoStore {
    urls: string[];
    links: Record<string, AutoTestRef[]>;
}
/**
 * The wire shape of GET /api/auto/<name>. Both fields are optional and both are
 * re-checked by loadAutoStore: the store is a sidecar FILE, so "the server sent
 * it" is not "the server validated it" - a hand-edited sidecar must degrade to
 * an empty store rather than throw at boot.
 */
export type AutoStoreResponse = Partial<AutoStore>;
/**
 * The merged automated+manual test-results bundle returned by loadResults():
 * automated xUnit results keyed by id, the editable manual-results store keyed
 * by id, the full discovered xUnit catalog, and the user's manual auto-test
 * connections; threaded through the whole coverage view and the ad-hoc test-run
 * flow.
 */
export interface CoverageResults {
    auto: Record<string, AutoResultEntry[]>;
    /**
     * What the runner writes (runner.js's TestRunRecord) is one of the two shapes
     * ManualResultRecord covers, which is why this is not typed as that record
     * alone.
     */
    manual: Record<string, ManualResultRecord>;
    autoCatalog: AutoTestCatalogEntry[];
    autoLinks: Record<string, AutoTestRef[]>;
}
/** The four states a requirement or test case can be in. */
export type CoverageStatusName = 'pass' | 'fail' | 'partial' | 'untested';
/**
 * The computed pass/fail/partial/untested status (plus rollup counts) for one
 * requirement or test id.
 */
export interface CoverageStatus {
    status: CoverageStatusName;
    pct: number | null;
    passed: number;
    failed: number;
    /** requirement rollup only (computeCoverage) */
    leaves?: number;
    /** requirement rollup only (computeCoverage) */
    testedLeaves?: number;
    /** requirement rollup only (computeCoverage) */
    reqs?: number;
}
/**
 * The per-id evidence bundle returned by testsFor(): flattened automated and
 * manual recorded results plus free-text report notes.
 */
export interface TestEvidence {
    auto: {
        kind: string;
        name: string;
        pass: boolean;
        message: string;
    }[];
    manual: {
        kind: string;
        name: string;
        response: string;
        pass: boolean;
    }[];
    report: string;
}
/**
 * One recorded step of a manual test: what the tester was asked to do, what they
 * saw, and their verdict. `pass === null` means "not recorded yet" and is
 * counted as neither a pass nor a failure.
 */
export interface ManualStep {
    step: string;
    response: string;
    pass: boolean | null;
}
/**
 * One id's stored manual result, as found in a per-source manual sidecar. Two
 * shapes coexist there - the newer multi-test wrapper ({tests:[...]}) and the
 * older single-test TestRunRecord ({steps, report}) - so every field is
 * optional; manualTests() is the one place that tells them apart.
 */
export interface ManualResultRecord {
    /** newer multi-test shape */
    tests?: ManualTestEntry[];
    /** older single-test shape */
    steps?: ManualStep[];
    report?: string;
    /** who recorded the run, and when */
    run?: TestRunMeta;
}
/**
 * One manual test entry after manualTests() has normalized the (possibly
 * legacy single-test) stored record into an array; every consumer downstream
 * (ownCounts, testsFor, coverage-report.js's step rendering) works off this.
 */
export interface ManualTestEntry {
    name?: string;
    steps: ManualStep[];
    report: string;
}
export declare function loadResults(sources: SourceConfig[]): Promise<CoverageResults>;
export declare function loadAutoStore(sourceName: string): Promise<AutoStore>;
export declare function connectAutomated(id: string, tc: AutoTestRef, sources: SourceConfig[]): Promise<boolean>;
export declare function disconnectAutomated(id: string, tc: AutoTestRef, sources: SourceConfig[]): Promise<boolean>;
export declare function rememberAutoUrl(url: string, id: string, sources: SourceConfig[]): Promise<boolean>;
/**
 * Parse ONE xUnit URL into a catalog list (for a just-pasted external URL).
 */
export declare function fetchXUnitCatalog(url: string): Promise<AutoTestCatalogEntry[]>;
/**
 * A requirement may hold several manual tests, each with its own steps. Older
 * stores had a single { steps, report } object; normalise both to an array.
 * @param m - one id's stored manual result record (may be the newer {tests:[...]}
 *   shape, the older single-test {steps,report} shape, or falsy)
 */
export declare function manualTests(m: ManualResultRecord): ManualTestEntry[];
/**
 * Status per requirement, rolled up over its subtree (the requirement plus
 * everything that traces to it, transitively).
 */
export declare function computeCoverage(requirements: RequirementEntry[], results: CoverageResults): Map<string, CoverageStatus>;
/**
 * Status per TEST CASE (its own recorded results, no rollup).
 */
export declare function computeTestStatus(tests: TestCaseEntry[], results: CoverageResults): Map<string, CoverageStatus>;
export declare function testsFor(id: string, results: CoverageResults): TestEvidence;
/**
 * @param manual - the full id -> result map
 */
export declare function saveManual(manual: Record<string, ManualResultRecord>, sources: SourceConfig[]): Promise<boolean>;
/**
 * Combined status map: requirement rollups (which include their Verified By
 * tests) plus each test case's own pass/fail. Keys never collide (T namespace).
 *
 * Lived in app-shell.js until Phase 2. That was the wrong home: app-shell.js is
 * imported by five modules, so a single line there for this one function pulled
 * this whole 464-line engine into every one of them, whether or not they ever
 * asked about coverage.
 */
export declare function combinedStatus(reqs: RequirementEntry[], tests: TestCaseEntry[], results: CoverageResults): Map<string, CoverageStatus>;
