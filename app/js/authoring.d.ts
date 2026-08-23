import type { SourceConfig } from './catalog.js';
/**
 * The options object handed to editor/panels.js's openNewDocModal: the source
 * list, an id-existence-check callback, and a creation callback invoked on submit.
 */
export interface NewDocModalOpts {
    sources: SourceConfig[];
    exists: (id: string) => boolean;
    onCreate: (id: string) => void;
}
/** Wire the header's new-document / edit / delete buttons. */
export declare function setupEditButtons(): void;
