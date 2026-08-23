import type { SourceConfig } from './catalog.js';
import type { CoverageResults } from './coverage.js';
import type { TestCaseEntry } from './requirements.js';
/**
 * Detail payload of the `webdoc:run-test` CustomEvent, dispatched by a
 * document's per-test-case Run button and consumed by setupTestRun.
 */
export interface RunTestEventDetail {
    testId: string;
}
declare global {
    interface DocumentEventMap {
        'webdoc:run-test': CustomEvent<RunTestEventDetail>;
    }
}
/**
 * The options object built for a single ad-hoc test run (triggered by a
 * document's per-test Run button) and handed to runner.js's openRunner, which
 * reads every field back out to render the run screen and later save results.
 */
export interface RunnerOpts {
    tests: TestCaseEntry[];
    results: CoverageResults;
    sources: SourceConfig[];
    onSaved: () => void;
}
