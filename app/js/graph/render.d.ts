import type { GraphContext } from '../graph.js';
export declare function computeNodeSize(g: GraphContext): {
    nodeW: number;
    nodeH: number;
};
/**
 * Sets g.extPos (id -> box) and g.nodePos (resolves either a doc node or an
 * external node by id); extends layout.width/height so fit()/minimap frame
 * the external boxes too.
 */
export declare function positionExternal(g: GraphContext): void;
/**
 * The colour tokens the canvas paints with, read out of the live CSS custom
 * properties once per theme and cached on the context as g.colors. `st` is a
 * lookup keyed by CoverageStatus.status, which is a plain string at every read
 * site, so it stays a table rather than a fixed-key record.
 */
export interface GraphColors {
    nodeBg: string;
    nodeBorder: string;
    text: string;
    muted: string;
    faint: string;
    accent: string;
    currentRing: string;
    currentBg: string;
    missingBorder: string;
    missingText: string;
    surface: string;
    prereq: string;
    recnext: string;
    trace: string;
    pagelink: string;
    st: Record<string, string>;
}
/**
 * Build the canvas + spatial grid index + precomputed edge polylines, then
 * install the draw loop and hit-test helpers. Called once per createGraph.
 */
export declare function renderScene(g: GraphContext): void;
/**
 * One node in flight during a relayout tween: where it sat before (ox,oy) and
 * where the new layout puts it (nx,ny), both in world coords. Only nodes that
 * actually moved get an entry.
 */
export interface TweenItem {
    id: string;
    ox: number;
    oy: number;
    nx: number;
    ny: number;
}
/**
 * FLIP-style relayout tween: interpolate node positions from `from` to their
 * newly laid-out spot over ~620ms (replaces the old CSS-transform animation).
 * @param from - previous world position per node/external-node id
 */
export declare function startTween(g: GraphContext, from: Map<string, {
    x: number;
    y: number;
}>): void;
