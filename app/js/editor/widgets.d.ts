import type { AccessStartBlock, AccessEndBlock } from '../editor.js';
/**
 * A table block. Cell values are inline HTML (rich text), not plain strings -
 * serialize.ts converts each cell to Markdown via htmlToMd on save.
 */
export interface TableBlock {
    type: 'table';
    headers: string[];
    aligns: string[];
    rows: string[][];
}
export declare function tableEditor(b: TableBlock): HTMLElement;
/**
 * One row of a requirement group: number + description (plain text) plus its
 * trace-to references (comma-joined ids, e.g. "sys_2, fn_3").
 */
export interface RequirementRow {
    no: string;
    description: string;
    traceTo: string;
}
export interface ReqBlock {
    type: 'requirement';
    group: string;
    rows: RequirementRow[];
}
/**
 * A requirement (or in-progress row) offered by the Trace-To / Verifies
 * reference picker's autocomplete.
 */
export interface ReqRef {
    id: string;
    description: string;
    docId?: string;
    group?: string;
}
/** Every requirement known right now (saved ones plus this doc's in-progress rows). */
export type GetReqs = () => ReqRef[];
export declare function requirementWidget(b: ReqBlock, getReqs: GetReqs): HTMLElement;
export interface TestStep {
    /** markdown source */
    action: string;
    /** markdown source */
    expected: string;
}
export interface TestCaseBlock {
    type: 'testcase';
    key: string;
    name: string;
    /** requirement/test ids this case verifies */
    verifies?: string[];
    steps: TestStep[];
}
/**
 * @param comp component id, for the "id: T_{comp}_{key}" preview
 */
export declare function testCaseWidget(b: TestCaseBlock, getReqs: GetReqs, comp?: string): HTMLElement;
/**
 * The editor view of an `<!--access start-->` / `<!--access end-->` marker.
 *
 * These are markers, not containers: the protected content is whatever blocks
 * sit BETWEEN them. Rendering them as visible bookends is what stops an author
 * moving or deleting one by accident - and what stops the editor silently
 * dropping a permission boundary it could not represent.
 *
 * The group pickers are disabled for anyone without access-management rights.
 * That is courtesy, not enforcement: the server compares the access rules in an
 * incoming save against the ones on disk and refuses the write either way.
 *
 * @param knownGroups groups declared in config.json, offered as checkboxes
 */
export declare function accessMarker(b: AccessStartBlock | AccessEndBlock, knownGroups?: string[]): HTMLElement;
