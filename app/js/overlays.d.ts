/**
 * One overlay host: the full-screen container plus the stage its owning module
 * renders into.
 */
export interface OverlayHost {
    /** the #graphOverlay / #covOverlay element itself */
    host: HTMLElement;
    /** the inner div the feature module fills */
    stage: HTMLElement;
}
/**
 * Create both overlay hosts. Called once from boot(), before anything can ask
 * about them. Idempotent, so a second call (a test, a hot reload) is harmless.
 */
export declare function ensureOverlayHosts(): void;
export declare function mapOverlay(): OverlayHost;
export declare function coverageOverlay(): OverlayHost;
/**
 * Is the document map currently on screen? Safe before ensureOverlayHosts() has
 * run - it answers false rather than throwing, because "not open" is the honest
 * answer for an overlay that does not exist yet, and the callers are asking in
 * order to decide whether to bother doing more work.
 */
export declare function mapOpen(): boolean;
export declare function coverageOpen(): boolean;
/**
 * Rebuild the document map, but only if it is actually open.
 *
 * This is the call authoring.ts and the change-watcher make after a write. It
 * loads map-view.js dynamically, so the graph engine is fetched only by a reader
 * who has opened the map - and a create/save/delete with the map closed costs
 * nothing and imports nothing.
 */
export declare function requestMapRebuild(): Promise<void>;
