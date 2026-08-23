/**
 * One flattened table-of-contents entry, produced per heading by
 * numberHeadings() in document order; buildTOC() renders an array of these
 * into the nested-looking TOC list.
 */
export interface TocEntry {
    /** heading level 1-6 (from the hN tag name) */
    level: number;
    /** dotted content number, e.g. "1.2.1" */
    number: string;
    /** heading textContent (numbering span excluded) */
    text: string;
    /** stable, collision-free element id assigned to the heading */
    id: string;
}
/**
 * Walk headings in document order, inject "1.2.1"-style labels, assign stable
 * ids, and return a flat TOC array.
 */
export declare function numberHeadings(root: ParentNode): TocEntry[];
