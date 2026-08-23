/**
 * Result of scanning a link destination (either `<...>` or a bare,
 * parenthesis-balanced run) starting at a source index; consumed wherever a
 * link or ref-def destination is parsed (md/blockpost.js, md/inline.js).
 */
export interface LinkDestScan {
    dest: string;
    pos: number;
}
/**
 * @param i index to start scanning from
 */
export declare function scanDest(text: string, i: number): LinkDestScan | null;
/**
 * Result of scanning an optional link title (quoted or parenthesized) starting
 * at a source index; consumed by both the ref-def parser (md/blockpost.js) and
 * the inline link/image closer (md/inline.js).
 */
export interface LinkTitleScan {
    title: string;
    pos: number;
}
/**
 * @param i index to start scanning from
 */
export declare function scanTitle(text: string, i: number): LinkTitleScan | null;
/**
 * @returns the case-folded, whitespace-collapsed label used as the refs map key
 */
export declare function normLabel(s: string): string;
/**
 * Result of scanning a `[...]` bracket label, used by md/inline.js to resolve
 * the collapsed/full reference-link form `[text][label]`.
 */
export interface BracketLabelScan {
    label: string;
    pos: number;
}
/**
 * @param i index to start scanning from (must point at the opening '[')
 */
export declare function scanBracketLabel(s: string, i: number): BracketLabelScan | null;
