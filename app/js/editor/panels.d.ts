import type { DocMeta } from './serialize.js';
import type { NewDocModalOpts } from '../authoring.js';
import type { DocAccess } from '../auth.js';
/**
 * One entry of the "Assumed knowledge" / "Recommended next" doc-picker lists;
 * only `id` and `title` are read here, out of the fuller GraphDocNode shape
 * (map-view.js) that callers actually pass in.
 */
export interface DocPickerEntry {
    id: string;
    title: string;
}
/**
 * @param meta edited in place: title/description directly, assumes/next via docPicker
 * @param selfId the document being edited, excluded from both pickers
 * @param access GET /api/index/access for this document; absent when accounts are
 *   switched off, in which case no access field is drawn
 */
export declare function metadataPanel(meta: Partial<DocMeta>, allDocs: DocPickerEntry[], selfId: string, access?: DocAccess | null): HTMLElement;
export declare function openNewDocModal(opts: NewDocModalOpts): void;
/**
 * Options for confirmDialog's reusable yes/no modal; built at every
 * delete/confirm callsite (authoring.js), including a cancelLabel:null
 * single-button "alert" variant.
 */
export interface ConfirmDialogOptions {
    title?: string;
    message?: string;
    confirmLabel?: string;
    /** null for a single-button acknowledgement (alert) */
    cancelLabel?: string | null;
    danger?: boolean;
}
/**
 * @returns resolves true if confirmed, false if cancelled
 */
export declare function confirmDialog(opts?: ConfirmDialogOptions): Promise<boolean>;
