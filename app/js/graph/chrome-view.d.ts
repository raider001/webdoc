import type { GraphOptions, GraphController } from '../graph.js';
/**
 * The handle mountGraphChrome() returns: the minimap surface the controller has
 * to be told about, the connect step that attaches the chrome to a live
 * controller, and the teardown that removes every element this module made.
 */
export interface GraphChromeHandle {
    /** pass to the controller as opts.minimapCanvas */
    minimapCanvas: HTMLCanvasElement;
    connect: (ctl: GraphController) => void;
    destroy: () => void;
}
/**
 * Build the overlay chrome for a graph inside `container`.
 *
 * `container` is the same element the controller renders its canvas into: the
 * chrome sits on top by z-index (see app/css/graph.css), not by DOM order, and
 * NOTHING here ever clears the container - that habit is exactly what made the
 * engine and a component renderer fight over the same children.
 */
export declare function mountGraphChrome(container: HTMLElement, options?: GraphOptions): GraphChromeHandle;
