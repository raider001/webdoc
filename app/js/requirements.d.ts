export { setCoverageStatus } from './requirements/store.js';
export { resolveRequirementRef, preprocessRequirements } from './requirements/parse.js';
export { renderRequirements, blockMarkdown, inlineMarkdown } from './requirements/render.js';
import type { Doc, SourceConfig } from './catalog.js';
import type { ReqOrTestBlock } from './requirements/parse.js';
/**
 * One test-case step: an action and its expected response. Same shape as the
 * editor's own step objects (editor/widgets.js's TestStep) - structured data in
 * the meta header now (any markdown allowed), though older docs kept steps in a
 * table (requirements/parse.js's extractTestCase reads both forms).
 *
 * Re-exported rather than redeclared so there is exactly one definition: this is
 * the name the rest of the app (report.js, requirements/parse.js) imports it by.
 */
import type { TestStep } from './editor/widgets.js';
export type { TestStep };
/**
 * One requirement record (an R_ id). Built per-document by requirements/parse.js's
 * extractReqGroup and, in fuller form (with resolved traceFrom/verifiedBy), from
 * the server's global coverage index by buildRequirementIndex/requirementList.
 */
export interface RequirementEntry {
    id: string;
    docId: string;
    component: string;
    group: string;
    no: string;
    description: string;
    traceTo: string[];
    traceFrom: string[];
    verifiedBy: string[];
}
/**
 * One test-case record (a T_ id). Built per-document by requirements/parse.js's
 * extractTestCase and, in fuller form, from the server's global index by
 * buildRequirementIndex/testList.
 */
export interface TestCaseEntry {
    id: string;
    docId: string;
    component: string;
    key: string;
    name: string;
    steps: TestStep[];
    /**
     * the ids exactly as authored. Optional because testList()'s projection
     * deliberately drops it and carries only the resolved `verifies`.
     */
    verifiesRaw?: string[];
    verifies: string[];
}
/**
 * A plain doc-to-doc reference pair. The same {from,to} shape is independently
 * produced twice - as requirement-trace edges (requirementTraceEdges, below) and
 * as in-body page-link edges (doclinks.js) - and consumed identically by the graph.
 */
export interface DocEdgeRef {
    from: string;
    to: string;
}
/**
 * One requirement row of GET /api/index/coverage. Everything the client defaults
 * below is optional here, for the same reason the graph payload's collections
 * are: an index built by an older server simply omits a field, and that must
 * read as "empty", not as a crash inside the boot sequence.
 */
export interface CoverageIndexRequirement {
    id: string;
    docId: string;
    component: string;
    group: string;
    no: string;
    description?: string;
    traceTo?: string[];
    traceFrom?: string[];
    verifiedBy?: string[];
}
/** One test row of GET /api/index/coverage. */
export interface CoverageIndexTest {
    id: string;
    docId: string;
    component: string;
    key: string;
    name?: string;
    steps?: TestStep[];
    verifies?: string[];
}
/**
 * The wire response of GET /api/index/coverage: the whole corpus's requirements
 * and tests with their trace-from / verified-by / verifies already resolved
 * server-side.
 */
export interface CoverageIndexResponse {
    requirements?: CoverageIndexRequirement[];
    tests?: CoverageIndexTest[];
}
/**
 * @param _docs - not read by this function; every current call site passes null
 *   now that the index comes from the server instead of being built by scanning
 *   docs. Underscored, not dropped: the exported signature is the API
 *   third-party renderer plugins import.
 */
export declare function buildRequirementIndex(_docs: Doc[] | null, sources: SourceConfig[]): Promise<void>;
/**
 * Parse the CURRENT document's requirement/test blocks from its (already-loaded)
 * body and stash them for renderRequirements, enriched with the global trace-from /
 * verified-by / verifies resolved by the server. Only the displayed doc is parsed.
 * @param body - raw markdown
 * @param source - source name, for component lookup (see componentOf)
 */
export declare function prepareDocGroups(body: string, docId: string, source: string): ReqOrTestBlock[];
/**
 * Every known requirement (for the coverage rollup and the editor picker).
 * @returns sorted by id
 */
export declare function requirementList(): RequirementEntry[];
/**
 * Every known test case (for the coverage rollup, graph, runner and editor).
 * @returns sorted by id (verifiesRaw is omitted from this projection - only the
 *   resolved verifies list is included)
 */
export declare function testList(): TestCaseEntry[];
export declare function revealRequirement(reqId: string): void;
export declare function revealTest(testId: string): void;
/**
 * @param query - the part of the hash route after '?', without the '?'
 */
export declare function routeParams(query: string): {
    req: string | null;
    test: string | null;
};
/**
 * Document -> document trace edges, for the map view's requirement-trace layer.
 */
export declare function requirementTraceEdges(): DocEdgeRef[];
