import type { RunnerOpts } from './main.js';
/**
 * One step's live run state inside a test's working model: the definition
 * (action/expected, both Markdown source, carried over unchanged from the
 * TestCaseEntry) plus what the tester has recorded this run.
 */
export interface RunStep {
    /** Markdown source */
    action: string;
    /** Markdown source */
    expected: string;
    /** the tester's recorded response, as HTML */
    actual: string;
    /** null when not yet recorded */
    pass: boolean | null;
}
/**
 * One test case's working run state, pre-populated from its latest stored
 * result (if any) so a re-run starts where the last one left off. `dirty`
 * gates which tests Save actually rewrites - untouched tests keep whatever
 * result is already stored.
 */
export interface RunTest {
    id: string;
    name: string;
    /** requirement/test ids this test verifies */
    verifies: string[];
    dirty: boolean;
    /** HTML */
    notes: string;
    steps: RunStep[];
}
/**
 * Who ran a test and when.
 */
export interface TestRunMeta {
    /** ISO timestamp */
    at: string;
    /** tester name */
    by: string;
}
/**
 * One test's stored manual run outcome, keyed by test id inside a per-source
 * manual-results sidecar (CoverageResults.manual).
 */
export interface TestRunRecord {
    run: TestRunMeta;
    steps: {
        step: string;
        response: string;
        pass: boolean | null;
    }[];
    /** HTML */
    report: string;
}
/** Close and remove the run overlay, if one is open. */
export declare function closeRunner(): void;
/**
 * Open the full-screen test-run overlay for a set of test cases.
 */
export declare function openRunner(opts: RunnerOpts): void;
