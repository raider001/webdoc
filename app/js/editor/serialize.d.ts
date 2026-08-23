import type { Block, ImageBlock, HrBlock, CodeBlock, AccessStartBlock, AccessEndBlock } from '../editor.js';
import type { TableBlock, ReqBlock, TestCaseBlock } from './widgets.js';
/**
 * A document header's `access` block, as the editor round-trips it: `read` names
 * the groups allowed to read the page, `hidden` withholds it from the map and
 * search. serializeDoc writes the object straight back out, so a key the server
 * understands and this editor does not still survives a save.
 */
export interface DocAccessRule {
    read?: string[];
    hidden?: boolean;
}
/**
 * The normalized document front-matter bundle read from / written to the
 * <!--meta ...--> header. serializeDoc/parseDoc (this file) are the canonical
 * write/read; editor.ts's working `meta` object and editor/panels.ts's
 * metadataPanel share and mutate the same shape.
 */
export interface DocMeta {
    title: string;
    description: string;
    assumes: string[];
    next: string[];
    /** the document's access-control block, when it has one */
    access?: DocAccessRule | null;
    /** every OTHER header key, carried through untouched */
    _extra?: Record<string, unknown>;
}
export interface HeadingMdBlock {
    type: 'heading';
    level: number;
    /** Markdown source (already converted from HTML via htmlToMd) */
    text: string;
}
export interface ParagraphMdBlock {
    type: 'paragraph';
    /** Markdown source */
    text: string;
}
export interface QuoteMdBlock {
    type: 'quote';
    /** Markdown source */
    text: string;
}
export interface ListMdBlock {
    type: 'list';
    ordered: boolean;
    /** Markdown source, one entry per list item */
    items: string[];
}
/**
 * What blockToMd()/serializeDoc() actually consume: editor.ts's onSave already
 * converts the four inline-HTML block types (heading/paragraph/quote/list) from
 * their visual, HTML-holding Block form to Markdown source (text/items) before
 * calling serializeDoc; every other block type is passed through unchanged and
 * keeps its original Block shape. Deliberately distinct from both editor.ts's
 * HTML-based `Block` and md/blocks.ts's parser-tree node `MdBlockNode`.
 */
export type MdSourceBlock = HeadingMdBlock | ParagraphMdBlock | QuoteMdBlock | ListMdBlock | CodeBlock | TableBlock | ImageBlock | HrBlock | ReqBlock | TestCaseBlock | AccessStartBlock | AccessEndBlock;
export declare function htmlToMd(html: string): string;
/**
 * The object that BECOMES the header JSON: the four known fields, optionally
 * `access`, and then whatever unknown keys _extra carried in. Open-ended by
 * nature - a header key this editor has never heard of still has to be written
 * back out verbatim (see KNOWN_META_KEYS), so the shape genuinely is
 * "known fields plus arbitrary JSON", not a closed record.
 */
export type HeaderJson = Omit<DocMeta, '_extra'> & Record<string, unknown>;
export declare function serializeDoc(meta: Partial<DocMeta>, blocks: MdSourceBlock[]): string;
/**
 * The JSON inside an `<!--access start {...}-->` marker, as authors actually
 * write it: `read` tolerates a bare string as well as a list, and the spec is
 * sometimes nested one level under `access` (the same shape the header uses).
 */
export interface AccessSpec {
    read?: string | string[];
    label?: string;
    /** the nested form */
    access?: AccessSpec;
}
/**
 * The JSON inside a `<!--meta start {...}-->` block wrapper. One comment form
 * covers two block kinds - a test case and a requirement group - which is why
 * everything is optional, and every field has a legacy spelling beside it.
 */
export interface BlockMetaJson {
    test?: string;
    'test-case'?: string;
    name?: string;
    verifies?: string[];
    steps?: {
        action?: string;
        expected?: string;
        'expected-response'?: string;
        response?: string;
    }[];
    'requirement-group'?: string;
    group?: string;
}
/** What parseDoc hands back. */
export interface ParsedDoc {
    meta: DocMeta;
    blocks: Block[];
    /**
     * Non-zero when an access marker could not be represented as a block; the
     * caller must refuse to edit rather than save a document missing that
     * boundary.
     */
    lostMarkers: number;
}
/**
 * @param docMeta existing front-matter to preserve (a brand-new document passes
 *   {}). Deliberately open-ended: this is the RAW parsed header, and its unknown
 *   keys sit at the top level - collecting them into _extra is exactly what the
 *   loop at the end does.
 */
export declare function parseDoc(rawBody: string, docMeta?: Partial<DocMeta> & Record<string, unknown>): ParsedDoc;
/**
 * @param type a BLOCK_MENU entry's `type` (editor/ui.ts), or 'list-ordered'
 */
export declare function newBlock(type: string): Block;
