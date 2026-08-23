import { setLinkDocs, setLinkSearch } from './editor/richtext.js';
import type { SourceConfig } from './catalog.js';
import type { DocAccess } from './auth.js';
import type { DocMeta } from './editor/serialize.js';
import type { TableBlock, ReqBlock, TestCaseBlock, ReqRef } from './editor/widgets.js';
export { parseDoc } from './editor/serialize.js';
export { richText } from './editor/richtext.js';
export { openNewDocModal, confirmDialog } from './editor/panels.js';
export { setLinkDocs, setLinkSearch };
export interface HeadingBlock {
    type: 'heading';
    level: number;
    html: string;
}
export interface ParagraphBlock {
    type: 'paragraph';
    html: string;
}
export interface QuoteBlock {
    type: 'quote';
    html: string;
}
export interface ListBlock {
    type: 'list';
    ordered: boolean;
    itemsHtml: string[];
}
export interface CodeBlock {
    type: 'code';
    lang: string;
    code: string;
}
export interface ImageBlock {
    type: 'image';
    src: string;
    alt: string;
}
export interface HrBlock {
    type: 'hr';
}
/**
 * The opening half of a restricted section. It is a marker, not a container -
 * the protected blocks are the ones between it and its AccessEndBlock.
 */
export interface AccessStartBlock {
    type: 'access-start';
    /** group names allowed to read the section */
    read: string[];
    label: string;
}
export interface AccessEndBlock {
    type: 'access-end';
}
/**
 * A single visual block in the editor canvas. Every widget / serialize.ts /
 * blockField branch switches on `type`.
 */
export type Block = HeadingBlock | ParagraphBlock | QuoteBlock | ListBlock | CodeBlock | TableBlock | ImageBlock | HrBlock | ReqBlock | TestCaseBlock | AccessStartBlock | AccessEndBlock;
export interface EditorOpts {
    docId: string;
    /** document front-matter (title, assumes, next, description, ...) */
    meta: DocMeta;
    blocks: Block[];
    sources?: SourceConfig[];
    allDocs: {
        id: string;
        title: string;
    }[];
    isNew: boolean;
    onSave: (markdown: string, meta: DocMeta, status: HTMLElement) => void;
    onClose: () => void;
    /** every saved requirement, for Trace-To/Verifies autocomplete */
    requirements?: ReqRef[];
    component?: string;
    /** groups declared in config.json, offered by the access-marker pickers */
    knownGroups?: string[];
    /** this document's access state, for the metadata panel */
    docAccess?: DocAccess | null;
}
export declare function openEditor(opts: EditorOpts): HTMLElement;
