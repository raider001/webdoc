/**
 * Layout tuning-parameter bag: node box size, gaps between layers/rows/
 * components, barycenter-sweep iteration count, which connection type drives
 * the tree ('all'|'prereq'|'recnext'), and the node-count ceiling above which
 * the cosmetic branch-relocation pass is skipped. Defaulted here as LO and
 * merged with per-call overrides (auto-sized dimensions, map mode) before
 * being threaded through the layout pipeline (graph/layout.js).
 */
export interface LayoutOptions {
    nodeW: number;
    nodeH: number;
    hGap: number;
    vGap: number;
    compGap: number;
    iters: number;
    layoutMode?: string;
    relocateMax?: number;
}
declare const LO: LayoutOptions;
declare const MIN_K = 0.15, MAX_K = 3, FIT_MIN_K = 0.002;
declare const DRAG_THRESHOLD = 5;
declare const MINI_W = 168, MINI_H = 120, MINI_PAD = 6;
/**
 * @returns v clamped to [lo, hi]
 */
declare function clamp(v: number, lo: number, hi: number): number;
/**
 * Format a number to (at most) 3 decimal places. Used for the canvas font
 * strings render.js builds per zoom level, where the full float would churn the
 * font cache for no visible difference.
 */
declare function fmt(n: number): string;
export { LO, MIN_K, MAX_K, FIT_MIN_K, DRAG_THRESHOLD, MINI_W, MINI_H, MINI_PAD, clamp, fmt };
