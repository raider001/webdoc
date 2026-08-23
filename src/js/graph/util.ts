// graph/util.ts - constants and small pure helpers shared across the graph modules.

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

// Layout tuning. All in world units (pre-transform).
const LO: LayoutOptions = {
  nodeW: 210, nodeH: 76,   // node box size
  hGap: 110,  vGap: 40,    // gaps between layers (h) and rows (v)
  compGap: 90,             // vertical gap between disconnected components
  iters: 8                 // barycenter ordering sweeps
};

// Pan/zoom limits. MIN_K is the interactive floor; FIT_MIN_K is a much smaller
// floor used ONLY by fit(), so a huge (10k-50k node) layout can be framed in one
// view instead of overflowing when the true fit scale is below MIN_K. fit() also
// lowers the instance's live floor to the fitted scale, so you can always zoom
// back out to the whole-graph overview.
const MIN_K = 0.15, MAX_K = 3, FIT_MIN_K = 0.002;
const DRAG_THRESHOLD = 5; // px of pointer travel before a press becomes a drag

// Minimap box dimensions.
const MINI_W = 168, MINI_H = 120, MINI_PAD = 6;

/**
 * @returns v clamped to [lo, hi]
 */
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
/**
 * Format a number to (at most) 3 decimal places. Used for the canvas font
 * strings render.js builds per zoom level, where the full float would churn the
 * font cache for no visible difference.
 */
function fmt(n: number): string { return String(Math.round(n * 1000) / 1000); }

export { LO, MIN_K, MAX_K, FIT_MIN_K, DRAG_THRESHOLD, MINI_W, MINI_H, MINI_PAD, clamp, fmt };
