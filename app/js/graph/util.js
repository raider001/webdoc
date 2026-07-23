// graph/util.js - constants and small pure helpers shared across the graph modules.

const SVGNS = 'http://www.w3.org/2000/svg';

// Layout tuning. All in world units (pre-transform).
const LO = {
  nodeW: 210, nodeH: 76,   // node box size
  hGap: 110,  vGap: 40,    // gaps between layers (h) and rows (v)
  compGap: 90,             // vertical gap between disconnected components
  iters: 8                 // barycenter ordering sweeps
};

// Pan/zoom limits.
const MIN_K = 0.15, MAX_K = 3;
const DRAG_THRESHOLD = 5; // px of pointer travel before a press becomes a drag

// Minimap box dimensions.
const MINI_W = 168, MINI_H = 120, MINI_PAD = 6;

function svg(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function fmt(n) { return String(Math.round(n * 1000) / 1000); }
function cssEscape(id) {
  return (window.CSS && CSS.escape) ? CSS.escape(id) : String(id).replace(/([^\w-])/g, '\\$1');
}

// Bezier path through a chain of points (horizontal tangents).
function edgePath(points) {
  if (points.length < 2) return '';
  let d = 'M ' + fmt(points[0].x) + ' ' + fmt(points[0].y);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = (b.x - a.x) * 0.5;
    d += ' C ' + fmt(a.x + dx) + ' ' + fmt(a.y) + ' ' + fmt(b.x - dx) + ' ' + fmt(b.y) + ' ' + fmt(b.x) + ' ' + fmt(b.y);
  }
  return d;
}

export { SVGNS, LO, MIN_K, MAX_K, DRAG_THRESHOLD, MINI_W, MINI_H, MINI_PAD, svg, clamp, fmt, cssEscape, edgePath };
