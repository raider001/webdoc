/**
 * Tuning knobs for the pan/zoom viewport, all optional.
 */
export interface PanZoomOptions {
    /** viewport frame height in px (default 440) */
    height?: number;
    /** minimum zoom scale (default 0.05) */
    minScale?: number;
    /** maximum zoom scale (default 8) */
    maxScale?: number;
    /** fraction of the frame `fit()` scales content to fill (default 0.94) */
    padding?: number;
}
/**
 * Wrap `content` (typically a rendered SVG, or a div wrapping one) in a
 * pan/zoom viewport: drag to pan, the +/- buttons (or the wheel once the
 * frame is focused) to zoom, arrow keys to pan and 0 to fit, plus a one-time
 * auto-fit once the frame is first measured after mounting.
 * @param content - moved into the viewport's stage, not cloned
 * @returns the viewport element, already containing `content` and its zoom controls
 */
export declare function createPanZoom(content: HTMLElement | SVGElement, opts?: PanZoomOptions): HTMLElement;
