export declare const reThematic: RegExp;
export declare const reATX: RegExp;
export declare const reFence: RegExp;
export declare const reBulletItem: RegExp;
export declare const reOrderedItem: RegExp;
export declare const reBlockquote: RegExp;
export declare const reSetext: RegExp;
export declare const reBlank: RegExp;
/**
 * Classify a line as an HTML-block start condition (CommonMark types 1-7).
 * @param canInterrupt true when the container is NOT an open paragraph (type 7 is only recognized then)
 * @returns the HTML block kind (1-7), or 0 if no HTML block starts here
 */
export declare function htmlBlockKind(line: string, canInterrupt: boolean): number;
/**
 * @param kind an HTML block kind as returned by htmlBlockKind
 * @returns whether this line's content closes the HTML block (kinds 6/7 close on a blank line instead, handled by the caller)
 */
export declare function htmlBlockCloses(kind: number, line: string): boolean;
/**
 * Tab-expanded leading-whitespace measurement for a line; used throughout
 * md/blocks.js's line loop to decide indentation-sensitive structure (indented
 * code, list markers, blockquote markers).
 */
export interface LineIndent {
    /** the leading whitespace width in columns (tabs expanded) */
    spaces: number;
    /** the character index in `s` where the leading whitespace ends */
    offset: number;
}
export declare function leading(s: string): LineIndent;
/**
 * Remove up to n columns of leading whitespace.
 */
export declare function removeIndent(s: string, n: number): string;
export declare function stripUpTo(s: string, n: number): string;
/**
 * Remove exactly n columns of leading whitespace, splitting a straddling tab.
 */
export declare function stripCols(s: string, n: number): string;
/**
 * Expand only the LEADING run of whitespace of `s`, measuring tab stops from
 * `startCol` so a tab after a list marker lands on the correct column.
 */
export declare function expandLeadingTabs(s: string, startCol: number): string;
