import type { RequirementEntry, TestCaseEntry } from '../requirements.js';
/**
 * The minimal per-document context extractGroups needs: just enough to compose
 * ids and resolve the source's component. requirements.js's prepareDocGroups
 * builds this ad hoc from the loaded Doc's id/source - it is not the full Doc
 * shape (catalog.js).
 */
export interface DocRef {
    id: string;
    source: string;
}
/**
 * A meta-block's table, parsed generically before knowing whether it is a
 * requirement group or a test case: the lower-cased/hyphenated header names, and
 * each data row as a header-name -> cell-text record (pick() reads known aliases
 * out of it).
 */
export interface ParsedTable {
    header: string[];
    rows: Record<string, string>[];
}
export interface ReqRefContext {
    component: string;
    group?: string;
}
/**
 * The JSON inside a `<!--meta start {…}-->` header. Authors write it by hand, so
 * every field is optional and several are spelled more than one way - the alias
 * hunts below are what reconcile them. This is the one place the two block
 * KINDS overlap: `requirement-group`/`group` mark a requirement table, `test`/
 * `test-case` mark a test case, and extractGroups picks the reader by which is
 * present.
 */
export interface BlockMeta {
    'requirement-group'?: string;
    group?: string;
    test?: string;
    'test-case'?: string;
    name?: string;
    steps?: AuthoredStep[];
    /** an array of ids, or the older comma-separated string */
    verifies?: unknown[] | string;
    /** the older singular spelling of `verifies` */
    verify?: string;
}
/**
 * One step exactly as an author may have written it in a test case's meta
 * header. Distinct from TestStep, which is the normalised {action, expected}
 * pair extractTestCase produces: an authored step may spell the response any of
 * three ways, and may omit either half.
 */
export interface AuthoredStep {
    action?: string;
    expected?: string;
    'expected-response'?: string;
    response?: string;
}
/**
 * One requirement-group block parsed from a document's meta-wrapped table
 * (`<!--meta start {"requirement-group":"nav"}-->`). Distinct from the editor's
 * ReqBlock (editor/widgets.js), which is the WYSIWYG in-progress widget shape.
 */
export interface ReqGroupBlock {
    kind: 'req';
    group: string;
    component: string;
    rows: RequirementEntry[];
    error: string | null;
}
/**
 * One test-case block parsed from a document's meta-wrapped table
 * (`<!--meta start {"test":"nav-tree",...}-->`). Distinct from the editor's
 * TestCaseBlock (editor/widgets.js), which is the WYSIWYG in-progress widget shape.
 */
export interface TestCaseDocBlock {
    kind: 'test';
    rec: TestCaseEntry;
    error: string | null;
}
/**
 * A single parsed block, in document order, as stored in requirements/store.js's
 * groupsByDoc and returned by extractGroups.
 */
export type ReqOrTestBlock = ReqGroupBlock | TestCaseDocBlock;
/**
 * @returns the id with any character outside [A-Za-z0-9_-] replaced by '-'
 *   (safe for use as an element id)
 */
export declare function cssSafe(id: unknown): string;
/**
 * A requirement ref: full id (R_WD_nav_1), group_no (nav_1, same component), or a
 * bare no (1, same group).
 * @returns the composed requirement id, or null if not found
 */
export declare function resolveReqRef(raw: string, ctx: ReqRefContext): string | null;
/**
 * A requirement ref (short or full) -> its composed id, or null. For the app to
 * match a test's `verifies` entries when linking / unlinking.
 */
export declare function resolveRequirementRef(raw: unknown, component: string): string | null;
/**
 * Find every meta-wrapped table in a document's raw markdown (skipping any that
 * are only a literal example inside a fenced code block) and parse each into a
 * requirement-group or test-case block, in document order.
 * @param body - raw markdown
 */
export declare function extractGroups(body: string, doc: DocRef, component: string): ReqOrTestBlock[];
/**
 * Replace each meta-wrapped region in the raw markdown with a fenced `reqgroup`
 * placeholder (`docId::n`); renderRequirements later swaps each placeholder for
 * its built table. Skips any meta block that is only a literal example inside a
 * fenced code block.
 */
export declare function preprocessRequirements(body: string, docId: string): string;
