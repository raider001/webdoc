export declare function editable(html: string, cls: string, onChange: (html: string) => void, placeholder?: string): HTMLElement;
export declare function listItem(html?: string): HTMLLIElement;
/**
 * A standalone rich-text field (contenteditable + the shared inline toolbar),
 * for callers outside the block editor (e.g. the manual-test editor).
 */
export declare function richText(html: string, onChange: (html: string) => void, placeholder?: string): HTMLElement;
/**
 * @param ed a contenteditable field
 */
export declare function attachInlineToolbar(ed: HTMLElement): void;
/**
 * @param fn resolves a relative image src for DISPLAY
 */
export declare function setImageResolver(fn: (url: string) => (string | null | undefined)): void;
/**
 * Only the bottom-left corner of the anchoring rect is ever read, so a bare
 * literal stands in for a DOMRect when there is nothing on screen to measure.
 */
export interface PopoverRect {
    bottom: number;
    left: number;
}
export interface ImagePopoverOptions {
    rect: PopoverRect;
    onApply: (alt: string, url: string) => void;
}
/**
 * One internal-document suggestion in the URL autocomplete: the id is what gets
 * inserted as the link target, the title is what the dropdown shows.
 */
export interface LinkDoc {
    id: string;
    title: string;
}
export declare function setLinkDocs(docs: LinkDoc[]): void;
export declare function setLinkSearch(fn: (query: string) => Promise<LinkDoc[]>): void;
export interface LinkPopoverOptions {
    rect: PopoverRect;
    text: string;
    url: string;
    /** false for a formatted link, whose inner markup must survive */
    canText: boolean;
    onApply: (text: string, url: string) => void;
    /** null when there is no link to unlink yet */
    onRemove: (() => void) | null;
}
