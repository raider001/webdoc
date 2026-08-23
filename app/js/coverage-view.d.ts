import type { RequirementEntry, TestCaseEntry } from './requirements.js';
import type { CoverageStatus, TestEvidence } from './coverage.js';
import type { TestRunMeta } from './runner.js';
import type { OverlayHandle } from './map-view.js';
/**
 * The single input object generateReportHtml() (report.js) takes to build the
 * whole standalone, shareable HTML test report; assembled once by exportReport().
 */
export interface TestReportData {
    title: string;
    generatedAt: string;
    requirements: RequirementEntry[];
    tests: TestCaseEntry[];
    reqStatus: Map<string, CoverageStatus>;
    testStatus: Map<string, CoverageStatus>;
    detail: ({
        id: string;
    } & TestEvidence & {
        run: TestRunMeta | null;
    })[];
}
/**
 * Set up the full-screen Test Coverage overlay: expose close() through the
 * shared `app` registry, and return the handle main.js drives the header button
 * with.
 */
export declare function setupCoverageView(): OverlayHandle;
