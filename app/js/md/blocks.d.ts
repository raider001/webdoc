import type { RefDefinition } from './blockpost.js';
/**
 * The fields every block node carries regardless of its `type`.
 */
export interface MdBlockBase {
    children: MdBlockNode[];
    open: boolean;
    lines: string[];
    lastLineBlank: boolean;
}
/** The document root. */
export interface MdDocumentBlock extends MdBlockBase {
    type: 'document';
}
/** A block quote container. */
export interface MdBlockquoteBlock extends MdBlockBase {
    type: 'blockquote';
}
/** A thematic break (`<hr />`). */
export interface MdThematicBlock extends MdBlockBase {
    type: 'thematic';
}
/**
 * A paragraph, plus the two things a paragraph can be REWRITTEN INTO in place
 * while parsing: a setext underline promotes it to 'heading' (parseDocument),
 * and peeling link reference definitions off it can leave nothing behind, which
 * demotes it to 'empty' (blockpost.js). All three share one interface because
 * the parser mutates `type` on the SAME object rather than building a new node -
 * so the tag set here is exactly the set of tags such an object can hold.
 */
export interface MdParagraphBlock extends MdBlockBase {
    type: 'paragraph' | 'heading' | 'empty';
    /** heading only: 1-6 */
    level?: number;
    /** paragraph only, GFM task-list checkbox HTML */
    taskPrefix?: string;
}
/** A bullet or ordered list; holds only 'item' children. */
export interface MdListBlock extends MdBlockBase {
    type: 'list';
    listType: 'ordered' | 'bullet';
    /** the bullet character, or the ordered-list delimiter ('.' or ')') */
    marker: string;
    /** only meaningful (non-null) when listType is 'ordered' */
    start: number | null;
    tight: boolean;
    /** set when the list is created; never read back (see findings) */
    listItemGap?: boolean;
}
/** One list item. */
export interface MdItemBlock extends MdBlockBase {
    type: 'item';
    /**
     * the item's content-indent COLUMN - a number, unlike a list's `marker`,
     * which is the bullet character. Keeping the field name but splitting the
     * type is what stops `leading(rest).spaces >= b.marker` from silently
     * comparing a number against a string.
     */
    marker: number;
    /** the source line index the item opened on (blank-line rules need it) */
    openedLine: number;
}
/** An indented or fenced code block. */
export interface MdCodeBlock extends MdBlockBase {
    type: 'codeblock';
    kind: 'fenced' | 'indented';
    /** fenced only: the fence character */
    fence?: string;
    /** fenced only: the opening fence's length */
    fenceLen?: number;
    /** fenced only: the opening fence's indentation */
    fenceIndent?: number;
    /** fenced only: the info string */
    info?: string;
}
/** A raw HTML block. */
export interface MdHtmlBlock extends MdBlockBase {
    type: 'htmlblock';
    /** the CommonMark HTML-block kind, 1-7 - a NUMBER, unlike a codeblock's `kind` */
    kind: number;
}
/** One column's alignment in a GFM table; null is the default (no align attr). */
export type TableAlign = 'left' | 'right' | 'center' | null;
/** A GFM table, rewritten in from a paragraph by the ./tables.js post-pass. */
export interface MdTableBlock extends MdBlockBase {
    type: 'table';
    aligns: TableAlign[];
    headerCells: string[];
    bodyRows: string[][];
}
/**
 * The CommonMark/GFM block-tree node built by makeBlock() during PHASE 1
 * parsing; walked by the ref-def and tightness post-passes (./blockpost.js),
 * rewritten in place by the GFM table pass (./tables.js), and read leaf-by-leaf
 * by the PHASE 2 HTML renderer (./render.js, ../commonmark.js). Deliberately
 * distinct from the unrelated app/js/blocks.js fenced-block renderer registry.
 *
 * A DISCRIMINATED UNION on `type`: the per-variant field types are the whole
 * point. `marker` is a string on a list but a number on an item; `kind` is a
 * string on a codeblock but a number on an htmlblock. One flat object type
 * could not say that, so those pairs used to be interchangeable to the checker.
 */
export type MdBlockNode = MdDocumentBlock | MdBlockquoteBlock | MdThematicBlock | MdParagraphBlock | MdListBlock | MdItemBlock | MdCodeBlock | MdHtmlBlock | MdTableBlock;
/**
 * Maps the tag makeBlock() is called with to the variant it produces, so
 * `makeBlock('item', ...)` is typed as an MdItemBlock (and its `extra` bag is
 * checked against an item's fields) without any call-site casting.
 */
export interface MdBlockTypeMap {
    document: MdDocumentBlock;
    blockquote: MdBlockquoteBlock;
    thematic: MdThematicBlock;
    paragraph: MdParagraphBlock;
    heading: MdParagraphBlock;
    empty: MdParagraphBlock;
    list: MdListBlock;
    item: MdItemBlock;
    codeblock: MdCodeBlock;
    htmlblock: MdHtmlBlock;
    table: MdTableBlock;
}
/**
 * @param extra extra fields merged onto the new node (e.g. level, kind, marker)
 */
export declare function makeBlock<K extends keyof MdBlockTypeMap>(type: K, extra?: Partial<MdBlockTypeMap[K]>): MdBlockTypeMap[K];
/**
 * The {doc, refs} pair tying the finished MdBlockNode tree to its
 * link-reference-definition table; destructured by commonmark.js's public
 * renderMarkdown() before rendering.
 */
export interface ParsedDocument {
    doc: MdBlockNode;
    refs: Record<string, RefDefinition>;
}
/**
 * PHASE 1 entry point: parse Markdown source into a block tree + ref-def table.
 */
export declare function parseDocument(src: string): ParsedDocument;
