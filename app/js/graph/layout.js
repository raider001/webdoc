// graph/layout.js - the pure, DOM-free, deterministic layout pipeline.
//   buildModel   docs -> nodes + directed edges (+ self loops, "missing" nodes)
//   layoutGraph  nodeList + edges -> positioned nodes + routed edges (Sugiyama-lite)
// Everything here is unit-testable in isolation (no DOM, no state).
import { LO } from './util.js';

// ---------------------------------------------------------------------------
// Model: docs -> nodes + directed edges (+ self loops), with "missing" nodes
// created for any referenced id that is not a real doc.
// ---------------------------------------------------------------------------
export function buildModel(docs) {
  const byId = new Map();
  for (const d of docs) byId.set(d.id, d);

  const nodes = new Map(); // id -> { id, missing, title, desc }
  function ensure(id) {
    if (nodes.has(id)) return;
    const d = byId.get(id);
    nodes.set(id, {
      id: id,
      missing: !d,
      title: d ? (d.title || id) : id,
      desc: d ? (d.description || '') : ''
    });
  }
  for (const d of docs) ensure(d.id);

  const selfLoops = [];
  const seen = new Set();
  const edges = [];
  function addEdge(from, to, type) {
    ensure(from); ensure(to);
    if (from === to) { selfLoops.push({ id: from, type: type }); return; }
    const key = from + '\u0000' + to + '\u0000' + type;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from: from, to: to, type: type });
  }

  for (const d of docs) {
    const assumes = d.assumes || [];
    const next = d.next || [];
    for (const p of assumes) addEdge(p, d.id, 'prereq');   // P -> D
    for (const s of next)    addEdge(d.id, s, 'recnext');  // D -> S
  }

  return { nodes: nodes, edges: edges, selfLoops: selfLoops };
}

// ---------------------------------------------------------------------------
// Cycle breaking: DFS, reverse back edges. Returns a copy of each edge with
// { reversed, layoutFrom, layoutTo } where layoutFrom -> layoutTo is acyclic.
// ---------------------------------------------------------------------------
function breakCycles(nodeIds, edges) {
  const adj = new Map();
  for (const id of nodeIds) adj.set(id, []);
  edges.forEach((e, i) => adj.get(e.from).push(i));
  // Deterministic adjacency order: by target id then type.
  for (const list of adj.values()) {
    list.sort((a, b) => {
      const ea = edges[a], eb = edges[b];
      if (ea.to !== eb.to) return ea.to < eb.to ? -1 : 1;
      return ea.type < eb.type ? -1 : ea.type > eb.type ? 1 : 0;
    });
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  for (const id of nodeIds) color.set(id, WHITE);
  const reversed = new Array(edges.length).fill(false);

  const roots = nodeIds.slice().sort();
  for (const s of roots) {
    if (color.get(s) !== WHITE) continue;
    color.set(s, GRAY);
    const stack = [{ node: s, idx: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const list = adj.get(top.node);
      if (top.idx >= list.length) { color.set(top.node, BLACK); stack.pop(); continue; }
      const ei = list[top.idx++];
      const v = edges[ei].to;
      const c = color.get(v);
      if (c === GRAY) reversed[ei] = true;          // back edge -> reverse
      else if (c === WHITE) { color.set(v, GRAY); stack.push({ node: v, idx: 0 }); }
      // BLACK => forward/cross edge, leave as-is
    }
  }
  return edges.map((e, i) => reversed[i]
    ? { from: e.from, to: e.to, type: e.type, reversed: true,  layoutFrom: e.to,   layoutTo: e.from }
    : { from: e.from, to: e.to, type: e.type, reversed: false, layoutFrom: e.from, layoutTo: e.to });
}

// ---------------------------------------------------------------------------
// Weakly-connected components (union-find over undirected edges).
// Returns array of sorted id-arrays, ordered deterministically by first id.
// ---------------------------------------------------------------------------
function components(nodeIds, edges) {
  const parent = new Map();
  for (const id of nodeIds) parent.set(id, id);
  function find(x) { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); }
  for (const e of edges) union(e.from, e.to);
  const groups = new Map();
  for (const id of nodeIds) {
    const r = find(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(id);
  }
  const arr = Array.from(groups.values());
  for (const grp of arr) grp.sort();
  arr.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return arr;
}

// Lay out one component as a tidy tree. A breadth-first pass from the sourceless
// roots gives each node its shortest-path DEPTH (the column, x) and a spanning
// tree that follows the natural hierarchy - every node hangs under the first,
// shallowest parent that reaches it, so cross-links (extra parents) stay as
// secondary edges instead of hijacking the shape. The row (y) then comes from a
// subtree-grouped post-order sweep: each parent's children sit together as one
// contiguous block, centred on the parent, spaced only by their own size.
// Returns { coord: Map, width, height, edges }.
function layoutComponent(compIds, compEdges, o, tag) {
  // Build the tree from the ORIGINAL edge direction (from -> to), not the
  // cycle-broken layoutFrom/layoutTo: cross-area links can form cycles, and we
  // don't want edge-reversal to flip the natural hierarchy. BFS's visited-set
  // handles any real cycles; only edge DRAWING uses the acyclic layout order.
  // The "Map by" mode picks which connection TYPE shapes the tree; every edge is
  // still routed + drawn (visibility is the legend toggles' job, not the layout's).
  const mode = o.layoutMode || 'all';
  const isTree = (t) => mode === 'all' || t === mode;
  const children = new Map(), indeg = new Map();
  for (const id of compIds) { children.set(id, []); indeg.set(id, 0); }
  for (const e of compEdges) if (isTree(e.type)) { children.get(e.from).push(e.to); indeg.set(e.to, indeg.get(e.to) + 1); }
  for (const list of children.values()) list.sort();

  // BFS from sourceless roots -> shortest-path depth + natural-hierarchy tree.
  const depth = new Map(), treeKids = new Map(), placed = new Set();
  for (const id of compIds) treeKids.set(id, []);
  const roots = compIds.filter(id => indeg.get(id) === 0).sort();
  const queue = roots.slice();
  for (const r of roots) { depth.set(r, 0); placed.add(r); }
  for (let qi = 0; qi < queue.length; qi++) {
    const n = queue[qi];
    for (const c of children.get(n)) {
      if (!placed.has(c)) { placed.add(c); depth.set(c, depth.get(n) + 1); treeKids.get(n).push(c); queue.push(c); }
    }
  }
  for (const id of compIds) if (!placed.has(id)) { depth.set(id, 0); placed.add(id); roots.push(id); } // safety

  // Tidy y (Reingold-Tilford with contours): lay each subtree out, then stack
  // siblings only as far as their CONTOURS actually touch - a deep subtree nests
  // into the vertical space beside a shallow sibling instead of pushing it away,
  // so free space collapses while the parent stays centred on its children.
  // A subtree's contour is { low: depth -> lowest (max) cy, high: depth -> highest
  // (min) cy }; two nodes sharing a column must stay ROW apart centre-to-centre.
  const ROW = o.nodeH + o.vGap;
  const yc = new Map();
  const shiftTree = (n, dy) => { yc.set(n, yc.get(n) + dy); for (const c of treeKids.get(n)) shiftTree(c, dy); };
  // Slide subtree `sub` (contour rc) below the accumulated block `acc`, returning
  // the shift applied; merges rc into acc (mutating acc).
  const stackBelow = (acc, rc, sub) => {
    // Max over shared depths - NOT floored at 0: a negative shift slides this
    // subtree UP into free space above (so a deep branch's parent sits right below
    // the previous sibling and its children fill the gap), keeping sibling order.
    let shift = -Infinity;
    for (const [d, hy] of rc.high) if (acc.low.has(d)) shift = Math.max(shift, acc.low.get(d) + ROW - hy);
    if (!isFinite(shift)) shift = 0;   // no shared depth (shouldn't happen for real siblings)
    if (shift) shiftTree(sub, shift);
    for (const [d, ly] of rc.low) acc.low.set(d, ly + shift);                  // rc is below -> owns the low contour
    for (const [d, hy] of rc.high) if (!acc.high.has(d)) acc.high.set(d, hy + shift); // only where acc doesn't reach
    return shift;
  };
  const layoutSub = (n) => {
    const kids = treeKids.get(n);
    const d = depth.get(n);
    if (!kids.length) { yc.set(n, 0); return { low: new Map([[d, 0]]), high: new Map([[d, 0]]) }; }
    let acc = null;
    for (const c of kids) {
      const cc = layoutSub(c);
      if (!acc) acc = cc; else stackBelow(acc, cc, c);
    }
    const cy = (yc.get(kids[0]) + yc.get(kids[kids.length - 1])) / 2;          // centre parent on its children
    yc.set(n, cy);
    acc.low.set(d, acc.low.has(d) ? Math.max(acc.low.get(d), cy) : cy);
    acc.high.set(d, acc.high.has(d) ? Math.min(acc.high.get(d), cy) : cy);
    return acc;
  };
  let acc = null;
  for (const r of roots) { const rc = layoutSub(r); if (!acc) acc = rc; else stackBelow(acc, rc, r); }
  for (const id of compIds) if (!yc.has(id)) yc.set(id, 0); // safety (unreachable)

  // Relocation ("find fitting space"): the tidy pass strands small branches far
  // below their parent (a leaf dumped after tall siblings). Plain gravity can't
  // help - a neighbour blocks the slide. So JUMP each small subtree into the free
  // gap nearest its parent, within [parentY, currentY] so it never rises above the
  // parent (edges only shorten, never detach or cross). Smallest branches first,
  // so leaves drop into the gaps beside big deep subtrees. Whole subtrees move as
  // a unit; every column's occupancy is respected.
  {
    const parentOf = new Map();
    for (const [p, kids] of treeKids) for (const c of kids) parentOf.set(c, p);
    const subOf = new Map();
    const collect = (n) => { if (subOf.has(n)) return subOf.get(n); const s = [n]; for (const c of treeKids.get(n)) { collect(c); for (const x of subOf.get(c)) s.push(x); } subOf.set(n, s); return s; };
    for (const id of compIds) collect(id);
    const colNodes = new Map();
    for (const id of compIds) { const d = depth.get(id); if (!colNodes.has(d)) colNodes.set(d, []); colNodes.get(d).push(id); }
    const order = compIds.filter(id => parentOf.has(id)).sort((a, b) => subOf.get(a).length - subOf.get(b).length || yc.get(b) - yc.get(a));
    for (const r of order) {
      const y0 = yc.get(r), parentY = yc.get(parentOf.get(r));
      if (parentY >= y0 - ROW) continue;                     // already at/above parent
      const sub = subOf.get(r), subset = new Set(sub);
      // Forbidden ranges for r's origin Y, from every non-subtree node it could hit.
      const forb = [];
      for (const m of sub) {
        const ry = yc.get(m) - y0, d = depth.get(m);
        for (const o of colNodes.get(d)) if (!subset.has(o)) { const oy = yc.get(o); forb.push([oy - ry - ROW, oy - ry + ROW]); }
      }
      forb.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const iv of forb) { const last = merged[merged.length - 1]; if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]); else merged.push(iv.slice()); }
      const isFree = (Y) => { for (const iv of merged) if (Y > iv[0] + 1e-6 && Y < iv[1] - 1e-6) return false; return true; };
      // Candidate origins in [parentY, y0]: the range ends + every interval edge.
      const cands = [parentY, y0];
      for (const iv of merged) { if (iv[0] >= parentY && iv[0] <= y0) cands.push(iv[0]); if (iv[1] >= parentY && iv[1] <= y0) cands.push(iv[1]); }
      cands.sort((a, b) => a - b);                            // ascending -> first free is nearest the parent
      let bestY = null;
      for (const Y of cands) if (Y >= parentY - 1e-6 && Y <= y0 + 1e-6 && isFree(Y)) { bestY = Y; break; }
      if (bestY !== null && bestY < y0 - 0.5) shiftTree(r, bestY - y0);
    }
  }

  // Coordinates: column from depth, row from the tidy sweep.
  const COL = o.nodeW + o.hGap;
  const coord = new Map();
  for (const id of compIds) {
    const L = depth.get(id);
    const cy = yc.get(id);
    const x = L * COL;
    coord.set(id, { layer: L, isDummy: false, cx: x + o.nodeW / 2, cy: cy, x: x, y: cy - o.nodeH / 2 });
  }

  // Edges: a direct curve from the parent's right edge to the child's left edge.
  for (const e of compEdges) e._chain = [e.layoutFrom, e.layoutTo];

  // Bounding box then normalise so the component's own min is (0,0).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of coord.values()) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x + o.nodeW);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y + o.nodeH);
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
  for (const c of coord.values()) { c.cx -= minX; c.cy -= minY; c.x -= minX; c.y -= minY; }

  return { coord: coord, width: maxX - minX, height: maxY - minY, edges: compEdges };
}

// ---------------------------------------------------------------------------
// Pure, DOM-free, deterministic layout.
//   nodeList: [{ id, missing }]      (missing is informational only here)
//   edgeList: [{ from, to, type }]   (already de-duplicated by buildModel)
// Returns { nodes: Map(id -> {x,y,cx,cy,w,h}), edges: [...], width, height }.
// ---------------------------------------------------------------------------
export function layoutGraph(nodeList, edgeList, opts) {
  const o = Object.assign({}, LO, opts || {});
  const nodeIds = nodeList.map(n => n.id);
  if (!nodeIds.length) return { nodes: new Map(), edges: [], width: 0, height: 0 };

  const layoutEdges = breakCycles(nodeIds, edgeList);
  const comps = components(nodeIds, edgeList);

  const nodes = new Map();
  const edgesOut = [];
  let yCursor = 0, gWidth = 0;

  for (let ci = 0; ci < comps.length; ci++) {
    const compIds = comps[ci];
    const set = new Set(compIds);
    const compEdges = layoutEdges.filter(e => set.has(e.layoutFrom));
    const res = layoutComponent(compIds, compEdges, o, ci);

    // Stack this component below the previous one.
    for (const c of res.coord.values()) { c.cy += yCursor; c.y += yCursor; }

    for (const id of compIds) {
      const c = res.coord.get(id);
      nodes.set(id, { id: id, x: c.x, y: c.y, cx: c.cx, cy: c.cy, w: o.nodeW, h: o.nodeH });
    }
    for (const e of res.edges) {
      const ch = e._chain;
      const pts = ch.map((vid, idx) => {
        const c = res.coord.get(vid);
        if (idx === 0) return { x: c.x + o.nodeW, y: c.cy };            // right side of left-most (real) node
        if (idx === ch.length - 1) return { x: c.x, y: c.cy };         // left side of right-most (real) node
        return { x: c.cx, y: c.cy };                                   // dummy waypoint
      });
      edgesOut.push({ from: e.from, to: e.to, type: e.type, reversed: e.reversed, points: pts, head: e.reversed ? 'start' : 'end' });
    }
    yCursor += res.height + o.compGap;
    gWidth = Math.max(gWidth, res.width);
  }

  return { nodes: nodes, edges: edgesOut, width: gWidth, height: Math.max(0, yCursor - o.compGap) };
}

// ---------------------------------------------------------------------------
// Radial "focus" layout: put `centerId` in the middle, its linked neighbours on
// a ring around it (a mind-map / sun-burst), and every OTHER node out on a much
// larger ring so it sits well outside the framed view ("furthest away", not
// hidden). Same return shape as layoutGraph, so renderScene draws it unchanged;
// width/height frame the centre + neighbour ring only, so fit() zooms to the
// focused cluster and the distant nodes fall off-screen.
//   neighborSet: Set of node ids directly linked to centerId (any edge type).
//   edgeList:    structural edges to draw as straight rays (from/to/type).
// ---------------------------------------------------------------------------
export function focusLayout(nodeList, edgeList, centerId, neighborSet, opts) {
  const o = Object.assign({}, LO, opts || {});
  const W = o.nodeW, H = o.nodeH, half = Math.hypot(W, H) / 2;
  const nodes = new Map();
  const put = (id, cx, cy) => nodes.set(id, { id: id, x: cx - W / 2, y: cy - H / 2, cx: cx, cy: cy, w: W, h: H });

  const ids = nodeList.map(n => n.id);
  const neighbours = ids.filter(id => id !== centerId && neighborSet.has(id)).sort();
  const others = ids.filter(id => id !== centerId && !neighborSet.has(id)).sort();

  put(centerId, 0, 0);

  // Neighbour ring: radius large enough that boxes don't collide along the arc
  // and stay clear of the centre box. First neighbour sits at the top.
  const nn = neighbours.length;
  const arc = Math.max(W, H) + 46;                         // spacing budget per neighbour
  const Rn = Math.max(2 * half + 90, nn ? (nn * arc) / (2 * Math.PI) : 0);
  neighbours.forEach((id, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, nn)) * 2 * Math.PI;
    put(id, Math.cos(a) * Rn, Math.sin(a) * Rn);
  });

  // The framed region is the centre + neighbour ring (+ padding). Distant nodes
  // go on a far ring, comfortably outside the frame.
  const frameR = Rn + half + 60;
  const Rf = frameR * 2.4 + Math.max(300, others.length * 6);
  const no = others.length;
  others.forEach((id, i) => {
    const a = (i / Math.max(1, no)) * 2 * Math.PI + 0.3;   // offset so they don't line up with rays
    put(id, Math.cos(a) * Rf, Math.sin(a) * Rf);
  });

  // Structural edges as straight rays between node centres.
  const edgesOut = [];
  for (const e of edgeList) {
    const a = nodes.get(e.from), b = nodes.get(e.to);
    if (!a || !b) continue;
    edgesOut.push({ from: e.from, to: e.to, type: e.type, reversed: false,
      points: [{ x: a.cx, y: a.cy }, { x: b.cx, y: b.cy }], head: 'end' });
  }

  // Shift so the FRAME's top-left is (0,0); distant nodes keep the same shift, so
  // they land at negative / beyond-width coords (off the fitted view). fit() uses
  // width/height = the frame, framing the centre + ring only.
  const shift = frameR;
  for (const c of nodes.values()) { c.x += shift; c.y += shift; c.cx += shift; c.cy += shift; }
  for (const e of edgesOut) for (const p of e.points) { p.x += shift; p.y += shift; }

  return { nodes: nodes, edges: edgesOut, width: 2 * frameR, height: 2 * frameR };
}
