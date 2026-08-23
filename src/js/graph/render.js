// graph/render.js - the CANVAS scene: one <canvas> for the whole graph, drawn with
// a uniform-grid spatial index + viewport culling + 3-tier level-of-detail so a
// 10k-50k node map stays fast (draw cost tracks what's ON SCREEN, not the corpus).
// Replaces the old one-SVG-<foreignObject>-per-node renderer. Public surface is
// unchanged (computeNodeSize / positionExternal / renderScene) so graph.js and the
// callers don't move. Draw STATE (current/flash/hover/selection/visibility) lives on
// the shared context `g` and is consulted each frame - there are no per-node DOM
// elements to toggle classes on anymore.
import { LO, clamp, fmt } from './util.js';

/** @typedef {import('../graph.js').GraphContext} GraphContext */
/** @typedef {import('../graph.js').GraphBox} GraphBox */
/** @typedef {import('../graph.js').GraphEdgeItem} GraphEdgeItem */
/** @typedef {import('./layout.js').ModelGraphNode} ModelGraphNode */
/** @typedef {import('./layout.js').LayoutNode} LayoutNode */
/** @typedef {import('../coverage.js').CoverageStatus} CoverageStatus */

// A test case is pass/fail/untested; a requirement shows its % passing.
/**
 * The status label shown under a node's title.
 * @param {CoverageStatus} st
 * @param {string} kind - 'test' | 'req' (g.kindOf(id))
 * @returns {string}
 */
function covLabel(st, kind) {
  if (kind === 'test') return st.status === 'pass' ? 'Pass' : st.status === 'fail' ? 'Fail' : st.status === 'partial' ? 'Partial' : 'Untested';
  return (st.pct === null || st.pct === undefined) ? 'untested' : (st.pct + '% passing');
}

// Uniform auto-sizing (opts.autoSize, coverage view): pick ONE box size big enough
// for the widest title + the content lines. Uses CANVAS text measurement - no DOM,
// no forced reflow (the old version did ~2 reflows per node; this does none).
/**
 * @param {GraphContext} g
 * @returns {{nodeW: number, nodeH: number}}
 */
export function computeNodeSize(g) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = '600 13.5px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  let titleW = 0;
  for (const meta of g.model.nodes.values()) titleW = Math.max(titleW, ctx.measureText(meta.title || '').width);
  const W = clamp(Math.ceil(titleW) + 28, LO.nodeW, g.opts.maxNodeW || 360);
  let hasStatus = false, hasDesc = false;
  for (const meta of g.model.nodes.values()) {
    if (g.statusOf(meta.id)) hasStatus = true;
    if (meta.desc || meta.missing) hasDesc = true;
    if (hasStatus && hasDesc) break;
  }
  let H = 20 + 34;              // vertical padding + up to two title lines
  if (hasStatus) H += 16;       // coverage/status line
  if (hasDesc) H += 30;         // description (up to two lines) or the "missing" tag
  return { nodeW: W, nodeH: clamp(H, LO.nodeH, g.opts.maxNodeH || 240) };
}

// Position external-link nodes in a column to the right of / below the doc layout,
// then extend the layout bounds so fit()/minimap frame them too. Sets g.extPos and
// g.nodePos (resolves either a doc node or an external node by id). (DOM-free math,
// unchanged from the SVG renderer.)
/**
 * Sets g.extPos (id -> box) and g.nodePos (resolves either a doc node or an
 * external node by id); extends layout.width/height so fit()/minimap frame
 * the external boxes too.
 * @param {GraphContext} g
 * @returns {void}
 */
export function positionExternal(g) {
  const extPos = new Map();
  const layout = g.layout;
  if (g.externalNodes.length) {
    const EXT_W = 172, EXT_H = 46, DROP = 44;
    /** @type {Map<string, string[]>} */
    const srcOf = new Map();                    // external id -> the doc ids that link to it
    for (const pl of g.pageLinks) {
      if (String(pl.to).indexOf('ext:') === 0) {
        if (!srcOf.has(pl.to)) srcOf.set(pl.to, []);
        srcOf.get(pl.to).push(pl.from);
      }
    }
    const PAD = 16;
    /**
     * @param {number} x - candidate top-left for an EXT_W x EXT_H box
     * @param {number} y
     * @returns {boolean} whether it would overlap a doc node or an already-placed external box
     */
    const hits = (x, y) => {
      for (const [, n] of layout.nodes)
        if (x < n.x + n.w + PAD && x + EXT_W + PAD > n.x && y < n.y + n.h + PAD && y + EXT_H + PAD > n.y) return true;
      for (const [, p] of extPos)
        if (x < p.x + p.w + PAD && x + EXT_W + PAD > p.x && y < p.y + p.h + PAD && y + EXT_H + PAD > p.y) return true;
      return false;
    };
    const STEP = 20, MAXR = 120;
    /**
     * @param {number} ax - the wanted top-left (under the linking doc)
     * @param {number} ay
     * @returns {{x: number, y: number}} the wanted spot if free, else the first
     *   free spot on an expanding ring around it, else a slot below everything
     */
    const nearestFree = (ax, ay) => {
      if (ax >= 0 && ay >= 0 && !hits(ax, ay)) return { x: ax, y: ay };
      for (let r = 1; r <= MAXR; r++) {
        const rad = r * STEP, N = 12 + r * 4;
        for (let i = 0; i < N; i++) {
          const ang = (i / N) * Math.PI * 2;
          const x = ax + Math.cos(ang) * rad, y = ay + Math.sin(ang) * rad;
          if (x >= 0 && y >= 0 && !hits(x, y)) return { x: x, y: y };
        }
      }
      return { x: Math.max(0, ax), y: ay + MAXR * STEP };
    };
    for (const en of g.externalNodes) {
      let src = null;
      for (const s of (srcOf.get(en.id) || [])) { const p = layout.nodes.get(s); if (p) { src = p; break; } }
      const pos = src
        ? nearestFree(src.x + src.w / 2 - EXT_W / 2, src.y + src.h + DROP)
        : { x: 0, y: layout.height + 60 };
      extPos.set(en.id, { x: pos.x, y: pos.y, w: EXT_W, h: EXT_H });
      layout.width = Math.max(layout.width, pos.x + EXT_W);
      layout.height = Math.max(layout.height, pos.y + EXT_H);
    }
  }
  g.extPos = extPos;
  g.nodePos = (id) => layout.nodes.get(id) || extPos.get(id) || null;
}

// ---------------------------------------------------------------------------
// Colour tokens: read the live CSS variables ONCE (so canvas matches the theme).
// A MutationObserver on <html data-theme> refreshes them + repaints on toggle.
// ---------------------------------------------------------------------------
/**
 * @param {Element} el
 * @returns {Object<string, *>} colour tokens read from `el`'s computed CSS
 *   custom properties (with fallbacks), plus a nested `st` sub-object for
 *   coverage-status colours
 */
function readColors(el) {
  const cs = getComputedStyle(el);
  /**
   * @param {string} n - CSS custom property name
   * @param {string} fb - used when the property is unset (canvas has no cascade to fall back on)
   * @returns {string}
   */
  const v = (n, fb) => (cs.getPropertyValue(n).trim() || fb);
  return {
    nodeBg: v('--graph-node-bg', '#fff'),
    nodeBorder: v('--graph-node-border', '#c7cdd6'),
    text: v('--text', '#111'),
    muted: v('--muted', '#667085'),
    faint: v('--faint', '#98a2b3'),
    accent: v('--accent', '#2563eb'),
    currentRing: v('--graph-current-ring', v('--accent', '#2563eb')),
    currentBg: v('--graph-current-bg', v('--accent-soft', '#e7efff')),
    missingBorder: v('--graph-missing-border', '#b7bdc7'),
    missingText: v('--graph-missing-text', '#7b828c'),
    surface: v('--surface', '#fff'),
    prereq: v('--prereq', '#2563eb'),
    recnext: v('--recnext', '#c2410c'),
    trace: v('--req-trace', '#7c3aed'),
    pagelink: v('--page-link', '#0d9488'),
    st: {
      pass: v('--cov-pass', '#16a34a'),
      fail: v('--cov-fail', '#dc2626'),
      partial: v('--cov-partial', '#d97706'),
      untested: v('--cov-untested', '#2563eb')
    }
  };
}
// Keyed by GraphEdgeItem.cat, which is a plain string off the edge item - so this
// is a lookup table, not a fixed-key record.
/** @type {Object<string, number[]>} */
const CAT_DASH = { prereq: [], recnext: [6, 5], trace: [2, 3], pagelink: [5, 3] };
/**
 * @param {Object<string,*>} colors - readColors() result
 * @param {string} cat - edge category ('prereq'|'recnext'|'trace'|'pagelink')
 * @returns {string} CSS colour for that edge category
 */
function catColor(colors, cat) { return cat === 'recnext' ? colors.recnext : cat === 'trace' ? colors.trace : cat === 'pagelink' ? colors.pagelink : colors.prereq; }

// Point on node n's border in the direction of (tx,ty) - for straight overlay edges.
/**
 * @param {GraphBox} n
 * @param {number} tx
 * @param {number} ty
 * @returns {{x: number, y: number}}
 */
function borderPoint(n, tx, ty) {
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx !== 0 ? (n.w / 2) / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? (n.h / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

// Wrap `text` to at most maxLines lines within maxW px (canvas ctx), ellipsizing.
/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxW
 * @param {number} maxLines
 * @returns {string[]}
 */
function wrapLines(ctx, text, maxW, maxLines) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (!cur || ctx.measureText(t).width <= maxW) cur = t;
    else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
  }
  if (lines.length < maxLines) lines.push(cur);
  const last = lines.length - 1;
  if (ctx.measureText(lines[last]).width > maxW) {
    let s = lines[last];
    while (s.length && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    lines[last] = s + '…';
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Build the canvas + spatial index + precomputed edge polylines, then the draw
// loop and hit-test helpers. Called once per createGraph (graph.js keeps calling
// this `renderScene`).
// ---------------------------------------------------------------------------
/**
 * Build the canvas + spatial grid index + precomputed edge polylines, then
 * install the draw loop and hit-test helpers. Called once per createGraph.
 * @param {GraphContext} g
 * @returns {void}
 */
export function renderScene(g) {
  const canvas = document.createElement('canvas');
  canvas.className = 'graph-svg';                 // reuse .graph-svg CSS (inset:0, cursor:grab)
  g.container.appendChild(canvas);
  g.canvas = canvas;
  g.svgEl = canvas;                               // view.js/interactions.js address the surface as g.svgEl
  g.ctx = canvas.getContext('2d');
  g.dpr = window.devicePixelRatio || 1;
  g.colors = readColors(g.container);

  // Draw-state defaults (were DOM classes in the SVG version).
  g.vis = { prereq: true, recnext: true, trace: true, pagelink: true, missing: true };
  g.hiddenStatuses = g.hiddenStatuses || new Set();
  g.hoverId = null; g.flashId = null; g.flashUntil = 0; g.tween = null;

  buildGrid(g);
  buildEdges(g);

  // --- resize backing store to the container * devicePixelRatio ---
  g.resize = function () {
    const rect = g.container.getBoundingClientRect();
    g.cssW = rect.width || g.container.clientWidth || 0;
    g.cssH = rect.height || g.container.clientHeight || 0;
    g.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(g.cssW * g.dpr));
    canvas.height = Math.max(1, Math.round(g.cssH * g.dpr));
    canvas.style.width = g.cssW + 'px';
    canvas.style.height = g.cssH + 'px';
    g.requestDraw();
  };

  // --- rAF scheduler: paint only when dirty; keep frames coming while tweening ---
  g.running = true; g.rafPending = false;
  g.requestDraw = function () {
    if (!g.running || g.rafPending) return;
    g.rafPending = true;
    g.rafId = requestAnimationFrame(function () {
      g.rafPending = false;
      if (g.tween) stepTween(g);
      draw(g);
      if (g.tween || (g.flashUntil && performance.now() < g.flashUntil)) g.requestDraw();
      else if (g.flashUntil && performance.now() >= g.flashUntil) { g.flashId = null; g.flashUntil = 0; draw(g); }
    });
  };
  g.drawStop = function () { g.running = false; if (g.rafId) cancelAnimationFrame(g.rafId); g.rafPending = false; };
  g.drawNow = function () { draw(g); };   // synchronous full frame (perf harness / tests)

  // Repaint on theme toggle so canvas colours track light/dark.
  g.themeObs = new MutationObserver(function () { g.colors = readColors(g.container); g.requestDraw(); });
  try { g.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) {}

  // --- hit-tests (replace DOM .closest) ---
  g.nodeAtWorld = function (wx, wy) {
    const cell = g.grid.cell;
    const key = Math.floor(wx / cell) + ',' + Math.floor(wy / cell);
    const ids = g.grid.map.get(key);
    if (!ids) return null;
    for (let i = ids.length - 1; i >= 0; i--) {
      const n = g.nodePos(ids[i]);
      if (n && wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) {
        const meta = g.model.nodes.get(ids[i]);
        if (meta && meta.missing && !g.vis.missing) continue;
        return ids[i];
      }
    }
    return null;
  };
  g.edgeAtWorld = function (wx, wy, tol) {
    let best = null, bestD = tol == null ? 8 : tol;
    for (const e of g.edgeItems) {
      if (!g.vis[e.cat]) continue;
      const a = e.aabb;
      if (wx < a[0] - bestD || wx > a[2] + bestD || wy < a[1] - bestD || wy > a[3] + bestD) continue;
      const pts = e.pts;
      for (let i = 1; i < pts.length; i++) {
        const d = segDist(wx, wy, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
        if (d < bestD) { bestD = d; best = e; }
      }
    }
    return best ? { from: best.from, to: best.to, type: best.type } : null;
  };

  g.resize();
  draw(g);
}

/**
 * Any one laid-out node (for its shared box size), or the LO default if the
 * layout is empty.
 * @param {GraphContext} g
 * @returns {LayoutNode|{w: number, h: number}}
 */
function firstNode(g) { for (const n of g.layout.nodes.values()) return n; return { w: LO.nodeW, h: LO.nodeH }; }

// Uniform grid over world space: cell ~ a few node-widths. Nodes are uniform boxes,
// so a grid beats a quadtree (no big-vs-tiny pathology) and is trivially cheap.
/**
 * Build a uniform spatial grid over world space (cell size ~ a few node
 * widths) mapping cell key -> node ids overlapping that cell, for O(visible)
 * hit-testing and culling instead of scanning every node.
 * @param {GraphContext} g
 * @returns {void}
 */
function buildGrid(g) {
  const nodeW = (g.layout.nodes.size ? firstNode(g).w : LO.nodeW);
  const cell = Math.max(256, Math.round(nodeW * 1.5));
  /** @type {Map<string, string[]>} */
  const map = new Map();
  /**
   * File `id` under every grid cell its box overlaps (a box wider than a cell
   * spans several, so culling never misses a partially-visible node).
   * @param {string} id
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @returns {void}
   */
  const add = (id, x, y, w, h) => {
    const c0 = Math.floor(x / cell), c1 = Math.floor((x + w) / cell);
    const r0 = Math.floor(y / cell), r1 = Math.floor((y + h) / cell);
    for (let cx = c0; cx <= c1; cx++) for (let cy = r0; cy <= r1; cy++) {
      const k = cx + ',' + cy; let a = map.get(k); if (!a) map.set(k, a = []); a.push(id);
    }
  };
  for (const [id, n] of g.layout.nodes) add(id, n.x, n.y, n.w, n.h);
  if (g.extPos) for (const [id, p] of g.extPos) add(id, p.x, p.y, p.w, p.h);
  g.grid = { cell: cell, map: map };
}

// Precompute every edge's world polyline + AABB + category, once per layout. Also
// index edges by endpoint node so the draw loop can pull only the edges touching a
// VISIBLE node (O(visible), not O(all edges) - the difference between 50k edges
// scanned every frame and a handful).
/**
 * Precompute every edge's world polyline + AABB + category once per layout
 * (structural layout edges, requirement-trace edges, and doc page-link
 * edges), and index them by endpoint node id (g.edgesByNode) so the draw loop
 * can pull only the edges touching a visible node.
 * @param {GraphContext} g
 * @returns {void}
 */
function buildEdges(g) {
  /** @type {GraphEdgeItem[]} */
  const items = [];
  /** @type {Map<string, number[]>} */
  const byNode = new Map();                       // node id -> INDICES into `items`
  /**
   * @param {string} from
   * @param {string} to
   * @param {string} type
   * @param {string} cat - the visibility key looked up in g.vis
   * @param {{x: number, y: number}[]} pts - world-space polyline
   * @param {string} head - which end carries the arrowhead, 'start' or 'end'
   * @returns {void}
   */
  const push = (from, to, type, cat, pts, head) => {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of pts) { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y; }
    const idx = items.length;
    items.push({ from: from, to: to, type: type, cat: cat, pts: pts, head: head, aabb: [minx, miny, maxx, maxy] });
    let af = byNode.get(from); if (!af) byNode.set(from, af = []); af.push(idx);
    let at = byNode.get(to); if (!at) byNode.set(to, at = []); at.push(idx);
  };
  for (const e of g.layout.edges) push(e.from, e.to, e.type, e.type, e.points, e.head);
  for (const te of g.traceEdges) {
    const a = g.layout.nodes.get(te.from), b = g.layout.nodes.get(te.to);
    if (!a || !b) continue;
    const p0 = borderPoint(a, b.x + b.w / 2, b.y + b.h / 2);
    const p1 = borderPoint(b, a.x + a.w / 2, a.y + a.h / 2);
    push(te.from, te.to, 'trace', 'trace', [p0, p1], 'end');
  }
  for (const pl of g.pageLinks) {
    const a = g.nodePos(pl.from), b = g.nodePos(pl.to);
    if (!a || !b) continue;
    const p0 = borderPoint(a, b.x + b.w / 2, b.y + b.h / 2);
    const p1 = borderPoint(b, a.x + a.w / 2, a.y + a.h / 2);
    push(pl.from, pl.to, 'pagelink', 'pagelink', [p0, p1], 'end');
  }
  g.edgeItems = items;
  g.edgesByNode = byNode;
}

/**
 * Distance from point (px,py) to the segment (ax,ay)-(bx,by).
 * @param {number} px
 * @param {number} py
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @returns {number}
 */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx, y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

// FLIP-style relayout tween: interpolate node positions from `from` to their laid-out
// spot over `dur` ms (replaces the old CSS-transform animation, DOM-only).
/**
 * One node in flight during a relayout tween: where it sat before (ox,oy) and
 * where the new layout puts it (nx,ny), both in world coords. Only nodes that
 * actually moved get an entry.
 * @typedef {{id: string, ox: number, oy: number, nx: number, ny: number}} TweenItem
 */

/**
 * FLIP-style relayout tween: interpolate node positions from `from` to their
 * newly laid-out spot over ~620ms (replaces the old CSS-transform animation).
 * @param {GraphContext} g
 * @param {Map<string, {x: number, y: number}>} from - previous world position per node/external-node id
 * @returns {void}
 */
export function startTween(g, from) {
  /** @type {TweenItem[]} */
  const items = [];
  g.layout.nodes.forEach((n, id) => { const o = from.get(id); if (o && (Math.abs(o.x - n.x) > 0.5 || Math.abs(o.y - n.y) > 0.5)) items.push({ id: id, ox: o.x, oy: o.y, nx: n.x, ny: n.y }); });
  if (g.extPos) g.extPos.forEach((p, id) => { const o = from.get(id); if (o && (Math.abs(o.x - p.x) > 0.5 || Math.abs(o.y - p.y) > 0.5)) items.push({ id: id, ox: o.x, oy: o.y, nx: p.x, ny: p.y }); });
  if (!items.length) return;
  g.tween = { items: items, start: performance.now(), dur: 620 };
  g.requestDraw();
}
/**
 * Advance the active relayout tween one frame, writing per-node screen
 * offsets into g.tweenOffset (eased with easeInOutCubic); clears g.tween/
 * g.tweenOffset once it completes.
 * @param {GraphContext} g
 * @returns {void}
 */
function stepTween(g) {
  const tw = g.tween; if (!tw) return;
  const t = Math.min(1, (performance.now() - tw.start) / tw.dur);
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;   // easeInOutCubic
  g.tweenOffset = new Map();
  for (const it of tw.items) g.tweenOffset.set(it.id, { dx: (it.ox - it.nx) * (1 - e), dy: (it.oy - it.ny) * (1 - e) });
  if (t >= 1) { g.tween = null; g.tweenOffset = null; }
}

// ---------------------------------------------------------------------------
// The frame. Cost tracks the viewport, not the corpus: cull to visible grid cells,
// drop detail (labels, then edges) as the projected node size shrinks.
// ---------------------------------------------------------------------------
/**
 * Paint one full frame: cull nodes to the viewport through the spatial grid,
 * draw only the edges touching a visible node, then draw the visible nodes on
 * top. Cost tracks what's on screen, not the corpus (viewport culling + a
 * 3-tier level-of-detail keyed on projected node size).
 * @param {GraphContext} g
 * @returns {void}
 */
function draw(g) {
  g.dirty = false;
  const ctx = g.ctx, k = g.k, tx = g.tx, ty = g.ty, C = g.colors;
  const cw = g.cssW, ch = g.cssH;
  ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!g.layout.nodes.size && !(g.extPos && g.extPos.size)) return;

  const off = g.tweenOffset;
  const nodeW = firstNode(g).w;
  const pxW = nodeW * k;                                  // projected node width, px
  const tier = pxW < 13 ? 0 : (pxW < 90 ? 1 : 2);        // 0 far / 1 mid / 2 near
  // viewport world-rect (with a small margin)
  const m = nodeW;
  const vx0 = (-tx) / k - m, vy0 = (-ty) / k - m, vx1 = (cw - tx) / k + m, vy1 = (ch - ty) / k + m;
  const px = (/** @type {number} */ x) => x * k + tx, py = (/** @type {number} */ y) => y * k + ty;
  /**
   * @param {string} id
   * @returns {GraphBox|null} the node's world box with the in-flight tween
   *   offset already folded in, so the draw loop never has to know about it
   */
  const posOf = (id) => { const n = g.nodePos(id); if (!n) return null; if (off) { const d = off.get(id); if (d) return { x: n.x + d.dx, y: n.y + d.dy, w: n.w, h: n.h }; } return n; };
  const vis = g.vis;

  // ---- Pass A: cull nodes to the viewport (collect; draw in pass C so edges sit under) ----
  const cell = g.grid.cell;
  const seen = new Set();
  // At far zoom thousands of nodes collapse onto one screen pixel - draw each pixel
  // once (current/flash always kept) so the fit frame stays cheap.
  const occ = tier === 0 ? new Set() : null;
  const viz = [];
  const cx0 = Math.floor(vx0 / cell), cx1 = Math.floor(vx1 / cell);
  const cy0 = Math.floor(vy0 / cell), cy1 = Math.floor(vy1 / cell);
  for (let cxi = cx0; cxi <= cx1; cxi++) for (let cyi = cy0; cyi <= cy1; cyi++) {
    const ids = g.grid.map.get(cxi + ',' + cyi);
    if (!ids) continue;
    for (const id of ids) {
      if (seen.has(id)) continue; seen.add(id);
      const meta = g.model.nodes.get(id);
      const isExt = !meta && g.extPos && g.extPos.has(id);
      if (meta && meta.missing && !vis.missing) continue;
      if (isExt && !vis.pagelink) continue;
      const st = g.statusOf(id);
      if (st && g.hiddenStatuses.has(st.status)) continue;
      const n = posOf(id);
      if (!n) continue;
      const sx = px(n.x), sy = py(n.y), sw = n.w * k, sh = n.h * k;
      if (sx > cw || sy > ch || sx + sw < 0 || sy + sh < 0) continue;
      if (occ && id !== g.currentId && id !== g.flashId) {
        const pk = ((sx + sw / 2) | 0) + '_' + ((sy + sh / 2) | 0);
        if (occ.has(pk)) continue; occ.add(pk);
      }
      viz.push({ id: id, meta: meta, isExt: isExt, st: st, sx: sx, sy: sy, sw: sw, sh: sh });
    }
  }

  // ---- Pass B: only the edges TOUCHING a visible node (O(visible), not O(all edges)) ----
  if (tier > 0 || g.focusId) {
    const se = g.selectedEdge, drawn = new Set();
    for (const vn of viz) {
      const eis = g.edgesByNode.get(vn.id);
      if (!eis) continue;
      for (const ei of eis) {
        if (drawn.has(ei)) continue; drawn.add(ei);
        const e = g.edgeItems[ei];
        if (!vis[e.cat]) continue;
        if (g.focusId && e.from !== g.focusId && e.to !== g.focusId) continue;
        if (tier === 0 && !(g.focusId || e.from === g.currentId || e.to === g.currentId)) continue;
        if ((vis.missing === false) && touchesMissing(g, e)) continue;
        if (g.hiddenStatuses.size) { const sf = g.statusOf(e.from), st2 = g.statusOf(e.to); if ((sf && g.hiddenStatuses.has(sf.status)) || (st2 && g.hiddenStatuses.has(st2.status))) continue; }
        const pts = e.pts;
        const sel = se && se.from === e.from && se.to === e.to && se.type === e.type;
        ctx.strokeStyle = sel ? C.accent : catColor(C, e.cat);
        ctx.lineWidth = sel ? 3 : 1.6;
        ctx.setLineDash(sel ? [] : (tier === 2 ? CAT_DASH[e.cat] : []));
        ctx.beginPath();
        ctx.moveTo(px(pts[0].x + doff(off, e.from, 'x')), py(pts[0].y + doff(off, e.from, 'y')));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i].x), py(pts[i].y));
        ctx.stroke();
        if (tier === 2) drawArrow(ctx, pts, e, k, tx, ty, catColor(C, e.cat));
      }
    }
    ctx.setLineDash([]);
  }

  // ---- Pass C: draw the visible nodes on top of their edges ----
  ctx.textBaseline = 'middle';
  for (const vn of viz) drawNode(g, ctx, vn.id, vn.meta, vn.isExt, vn.st, vn.sx, vn.sy, vn.sw, vn.sh, tier);
}
/**
 * @param {Map<string,{dx:number,dy:number}>|null} off - g.tweenOffset
 * @param {string} id
 * @param {'x'|'y'} ax
 * @returns {number} the tween offset along that axis, or 0 if none
 */
function doff(off, id, ax) { if (!off) return 0; const d = off.get(id); return d ? (ax === 'x' ? d.dx : d.dy) : 0; }
/**
 * @param {GraphContext} g
 * @param {{from: string, to: string}} e
 * @returns {boolean} whether either endpoint is a missing (dangling-reference) node
 */
function touchesMissing(g, e) { const a = g.model.nodes.get(e.from), b = g.model.nodes.get(e.to); return (a && a.missing) || (b && b.missing); }

/**
 * Draw the arrowhead at an edge's head end (prereq edges point AT the
 * prerequisite, i.e. the visually inverted end).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x: number, y: number}[]} pts
 * @param {{type: string, head: string}} e
 * @param {number} k - current zoom scale
 * @param {number} tx
 * @param {number} ty
 * @param {string} color
 * @returns {void}
 */
function drawArrow(ctx, pts, e, k, tx, ty, color) {
  // effective head end: prereq points AT the prerequisite (inverted), like the SVG.
  let head = e.head; if (e.type === 'prereq') head = head === 'start' ? 'end' : 'start';
  const tip = head === 'start' ? pts[0] : pts[pts.length - 1];
  const prev = head === 'start' ? pts[1] : pts[pts.length - 2];
  if (!prev) return;
  const ang = Math.atan2((tip.y - prev.y), (tip.x - prev.x));
  const X = tip.x * k + tx, Y = tip.y * k + ty, s = 7;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(X, Y);
  ctx.lineTo(X - s * Math.cos(ang - 0.4), Y - s * Math.sin(ang - 0.4));
  ctx.lineTo(X - s * Math.cos(ang + 0.4), Y - s * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw one node's box + border + text at its screen rect, at the given
 * level-of-detail tier (0 far: a filled dot only; 1 mid: plain rect, title
 * only if wide enough; 2 near: rounded box, title + coverage label + description).
 * @param {GraphContext} g
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} id
 * @param {ModelGraphNode|undefined} meta - undefined for an external-link node
 * @param {boolean} isExt
 * @param {CoverageStatus|null} st
 * @param {number} sx
 * @param {number} sy
 * @param {number} sw
 * @param {number} sh
 * @param {number} tier - 0 | 1 | 2
 * @returns {void}
 */
function drawNode(g, ctx, id, meta, isExt, st, sx, sy, sw, sh, tier) {
  const C = g.colors;
  const isCurrent = !isExt && id === g.currentId;
  const isFlash = id === g.flashId;
  const isSource = id === g.pendingSource;
  const isHover = id === g.hoverId;
  const missing = meta && meta.missing;
  const near = tier === 2;
  const fade = dimmed(g, meta);
  if (fade) ctx.globalAlpha = 0.32;
  const r = near ? Math.min(10 * g.k, Math.min(sw, sh) / 2) : 0;

  // ---- FAR: a tiny filled square, no box/text. fillRect is much cheaper than an
  // arc, which matters when the whole 50k-node graph is on screen at fit. ----
  if (tier === 0) {
    const farGroup = groupTint(g, meta);
    ctx.fillStyle = isCurrent ? C.currentRing : st ? statusColor(C, st.status)
      : missing ? C.missingBorder : isExt ? C.pagelink : (farGroup || C.muted);
    ctx.globalAlpha = missing ? 0.55 : (dimmed(g, meta) ? 0.35 : 0.9);
    const s = Math.max(1.5, Math.min(sw, sh) * 0.9);
    ctx.fillRect(sx + sw / 2 - s / 2, sy + sh / 2 - s / 2, s, s);
    ctx.globalAlpha = 1;
    return;
  }

  // ---- box: rounded (arcTo) only at NEAR zoom where few nodes are visible; plain
  // rectangles at MID zoom (a rounded corner per node is too costly en masse). ----
  if (isExt) { ctx.fillStyle = C.surface; }
  else if (st) { ctx.fillStyle = mix(statusColor(C, st.status), C.surface, missing ? 0 : 0.13); }
  else if (isCurrent) { ctx.fillStyle = C.currentBg; }
  else if (missing) { ctx.fillStyle = 'transparent'; }
  else { ctx.fillStyle = C.nodeBg; }
  if (!missing) { if (near) { roundRect(ctx, sx, sy, sw, sh, r); ctx.fill(); } else ctx.fillRect(sx, sy, sw, sh); }
  // border
  let bw = 1.25, bc = missing ? C.missingBorder : isExt ? C.pagelink : st ? statusColor(C, st.status) : C.nodeBorder;
  if (isCurrent) { bc = C.currentRing; bw = 2.5; }
  if (isSource) { bc = C.accent; bw = 3; }
  else if (isFlash || isHover) { bc = C.accent; bw = isFlash ? 3 : 2; }
  ctx.lineWidth = bw; ctx.strokeStyle = bc;
  ctx.setLineDash(missing || isExt ? [4, 3] : (st && st.status === 'untested' ? [4, 3] : []));
  if (near) { roundRect(ctx, sx, sy, sw, sh, r); ctx.stroke(); } else ctx.strokeRect(sx, sy, sw, sh);
  ctx.setLineDash([]);
  drawAccess(g, ctx, meta, sx, sy, sw, sh, tier);

  // ---- text (near only; mid draws title only if wide enough) ----
  if (tier === 1 && sw < 66) { if (fade) ctx.globalAlpha = 1; return; }
  const pad = 10, innerW = sw - pad * 2;
  if (innerW < 24) { if (fade) ctx.globalAlpha = 1; return; }
  const title = isExt ? (g.externalNodes.find(e => e.id === id) || {}).url || id : (meta ? meta.title : id);
  ctx.fillStyle = missing ? C.missingText : C.text;
  ctx.font = '600 ' + fmt(13.5 * g.k) + 'px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const lineH = 15 * g.k;
  const hasCov = !!st, hasDesc = !isExt && meta && (meta.missing ? true : !!meta.desc);
  const titleLines = wrapLines(ctx, title, innerW, tier === 2 ? 2 : 1);
  let cy = sy + pad + lineH / 2;
  // vertically center-ish: start so the block sits centered
  const blockH = titleLines.length * lineH + (hasCov ? 13 * g.k : 0) + (hasDesc ? 2 * 13 * g.k : 0);
  cy = sy + Math.max(pad, (sh - blockH) / 2) + lineH / 2;
  for (const ln of titleLines) { ctx.fillText(ln, sx + pad, cy); cy += lineH; }
  if (hasCov) {
    ctx.font = fmt(11 * g.k) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = statusColor(C, st.status);
    ctx.fillText(covLabel(st, g.kindOf(id)), sx + pad, cy + 2 * g.k); cy += 13 * g.k;
  }
  if (hasDesc && tier === 2) {
    ctx.font = fmt(11.5 * g.k) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = missing ? C.missingText : C.muted;
    const dtxt = missing ? 'missing' : meta.desc;
    const dLines = wrapLines(ctx, dtxt, innerW, 2);
    for (const ln of dLines) { ctx.fillText(ln, sx + pad, cy + 6 * g.k); cy += 13 * g.k; }
  }
  if (fade) ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Access-group decoration
// ---------------------------------------------------------------------------
/**
 * True when every group that can read this node is toggled off in the map's
 * group legend. Unrestricted nodes are never dimmed - "no groups" is not a group
 * you can switch off.
 * @param {GraphContext} g
 * @param {ModelGraphNode} meta
 * @returns {boolean}
 */
function dimmed(g, meta) {
  const groups = (meta && meta.groups) || [];
  if (!groups.length || !g.hiddenGroups || !g.hiddenGroups.size) return false;
  return groups.every(name => g.hiddenGroups.has(name));
}

/**
 * The first read group's colour, used as a node's identity tint at far zoom.
 * @param {GraphContext} g
 * @param {ModelGraphNode} meta
 * @returns {string|null}
 */
function groupTint(g, meta) {
  const groups = (meta && meta.groups) || [];
  return groups.length && g.groupColor ? g.groupColor(groups[0]) : null;
}

/**
 * Draw a node's access decoration: a stacked colour band down its left edge -
 * one stripe per group that can read it - and a small lock in the top-right
 * corner when this reader may see the page exists but not open it.
 *
 * The band is drawn INSIDE the border and clipped to the node, so it reads as
 * part of the node rather than as another edge.
 * @param {GraphContext} g
 * @param {CanvasRenderingContext2D} ctx
 * @param {ModelGraphNode} meta
 * @param {number} sx
 * @param {number} sy
 * @param {number} sw
 * @param {number} sh
 * @param {number} tier
 * @returns {void}
 */
function drawAccess(g, ctx, meta, sx, sy, sw, sh, tier) {
  const groups = (meta && meta.groups) || [];
  if (!groups.length && !(meta && meta.locked)) return;
  const bandW = Math.max(2.5, 4 * g.k);
  if (groups.length && g.groupColor) {
    const each = sh / groups.length;
    for (let i = 0; i < groups.length; i++) {
      ctx.fillStyle = g.groupColor(groups[i]);
      ctx.fillRect(sx + 0.5, sy + i * each + 0.5, bandW, Math.max(1, each - 1));
    }
  }
  if (meta && meta.locked && tier >= 1) {
    const size = Math.max(6, 9 * g.k);
    const x = sx + sw - size - Math.max(3, 5 * g.k), y = sy + Math.max(3, 5 * g.k);
    ctx.strokeStyle = g.colors.muted;
    ctx.fillStyle = g.colors.muted;
    ctx.lineWidth = Math.max(1, 1.2 * g.k);
    ctx.beginPath();                                  // shackle
    ctx.arc(x + size / 2, y + size * 0.38, size * 0.26, Math.PI, 0);
    ctx.stroke();
    ctx.fillRect(x + size * 0.16, y + size * 0.38, size * 0.68, size * 0.5);   // body
  }
}

/**
 * @param {Object<string,*>} C - g.colors
 * @param {string} s - a CoverageStatus.status value
 * @returns {string}
 */
function statusColor(C, s) { return C.st[s] || C.muted; }
/**
 * Trace a rounded-rect path (caller does the fill/stroke).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 * @returns {void}
 */
function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// Approximate CSS color-mix: blend hex `a` toward hex `b` by (1-t)*a + t*... actually
// return `a` at weight `w` over `b`. Falls back to a if parsing fails.
/**
 * @param {string} a
 * @param {string} b
 * @param {number} w - weight toward `a` (1 = pure a, 0 = pure b)
 * @returns {string} an "rgb(r,g,b)" string, or `a` unchanged on parse failure
 */
function mix(a, b, w) {
  const pa = hex(a), pb = hex(b);
  if (!pa || !pb) return a;
  const c = (/** @type {number} */ i) => Math.round(pa[i] * w + pb[i] * (1 - w));
  return 'rgb(' + c(0) + ',' + c(1) + ',' + c(2) + ')';
}
/**
 * Parse a hex (#rgb / #rrggbb) or rgb(a)(...) color string to an [r,g,b] triple.
 * @param {string} s
 * @returns {[number,number,number]|null}
 */
function hex(s) {
  s = String(s).trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(s) || /^#?([0-9a-f]{3})$/i.exec(s);
  if (!m) { const rm = /rgba?\(([^)]+)\)/.exec(s); if (rm) { const p = rm[1].split(',').map(n => parseFloat(n)); return [p[0], p[1], p[2]]; } return null; }
  let h = m[1]; if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
