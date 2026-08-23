/**
 * @param animate - animate nodes from their prior positions (tween) into the new layout
 * @param refit - fit fresh to the new layout frame instead of restoring the saved pan/zoom (used on a focus change)
 */
export declare function buildDocGraph(animate?: boolean, refit?: boolean): Promise<void>;
/**
 * An overlay's open/close handle, returned to main.js so it can own the button.
 */
export interface OverlayHandle {
    open: () => (void | Promise<void>);
    close: () => void;
    toggle: () => (void | Promise<void>);
}
/**
 * Set up the map overlay: expose close() through the shared `app` registry, and
 * return the handle main.js drives the header button with.
 */
export declare function setupGraphButton(): OverlayHandle;
