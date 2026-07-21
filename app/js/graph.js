// graph.js - the document-relationship "Map" view.
//
// A pannable / zoomable directed graph of documents, rendered as inline SVG.
// No graph library: the layout is a hand-written layered (Sugiyama-lite)
// algorithm and the pan/zoom is a single transform on a viewport <g>.
//
// Edge semantics (see createGraph docs below):
//   - an "assumes" entry P on doc D  => prerequisite edge  P -> D   (solid, --prereq)
//   - a "next"    entry S on doc D  => recommended-next edge D -> S (dashed, --recnext)
//
// The pure layout math (layoutGraph) is DOM-free and deterministic so it can be
// unit-tested in isolation; everything DOM/interaction lives in createGraph.

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

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function svg(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function fmt(n) { return String(Math.round(n * 1000) / 1000); }

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
  for (const g of arr) g.sort();
  arr.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return arr;
}

// Longest-path layering (Kahn topological order) over an acyclic component.
function layerComponent(compIds, compEdges) {
  const outAdj = new Map(), indeg = new Map();
  for (const id of compIds) { outAdj.set(id, []); indeg.set(id, 0); }
  for (const e of compEdges) { outAdj.get(e.layoutFrom).push(e.layoutTo); indeg.set(e.layoutTo, indeg.get(e.layoutTo) + 1); }
  const layer = new Map();
  for (const id of compIds) layer.set(id, 0);
  const q = compIds.filter(id => indeg.get(id) === 0);
  const deg = new Map(indeg);
  while (q.length) {
    q.sort();
    const u = q.shift();
    for (const v of outAdj.get(u)) {
      if (layer.get(u) + 1 > layer.get(v)) layer.set(v, layer.get(u) + 1);
      deg.set(v, deg.get(v) - 1);
      if (deg.get(v) === 0) q.push(v);
    }
  }
  return layer;
}

// Lay out a single component. Returns { coord: Map, width, height, edges }.
function layoutComponent(compIds, compEdges, o, tag) {
  const layer = layerComponent(compIds, compEdges);
  let maxLayer = 0;
  for (const id of compIds) maxLayer = Math.max(maxLayer, layer.get(id));

  // Insert dummy nodes for edges that span more than one layer.
  const dummy = new Map(); // dummyId -> layer
  let dseq = 0;
  for (const e of compEdges) {
    const lf = layer.get(e.layoutFrom), lt = layer.get(e.layoutTo);
    const chain = [e.layoutFrom];
    for (let L = lf + 1; L < lt; L++) {
      const did = '__d' + tag + '_' + (dseq++);
      dummy.set(did, L);
      chain.push(did);
    }
    chain.push(e.layoutTo);
    e._chain = chain;
  }

  // All layout vertices (real + dummy) grouped by layer.
  const vlayer = new Map();
  for (const id of compIds) vlayer.set(id, layer.get(id));
  for (const [d, L] of dummy) vlayer.set(d, L);
  const layers = [];
  for (let L = 0; L <= maxLayer; L++) layers[L] = [];
  for (const [id, L] of vlayer) layers[L].push(id);
  for (const a of layers) a.sort(); // deterministic seed order

  // Segment adjacency (over dummy-expanded chains).
  const preds = new Map(), succs = new Map();
  for (const id of vlayer.keys()) { preds.set(id, []); succs.set(id, []); }
  for (const e of compEdges) {
    const ch = e._chain;
    for (let i = 0; i + 1 < ch.length; i++) { succs.get(ch[i]).push(ch[i + 1]); preds.get(ch[i + 1]).push(ch[i]); }
  }

  // Barycenter ordering sweeps.
  const pos = new Map();
  for (const a of layers) a.forEach((id, i) => pos.set(id, i));
  function reorder(L, useNeighbors) {
    const arr = layers[L];
    const nb = useNeighbors === 'preds' ? preds : succs;
    const keyed = arr.map((id, idx) => {
      const ns = nb.get(id);
      let key;
      if (ns.length) { let s = 0; for (const n of ns) s += pos.get(n); key = s / ns.length; }
      else key = idx; // no neighbors in reference layer: keep current position
      return { id: id, key: key, idx: idx };
    });
    keyed.sort((a, b) => (a.key - b.key) || (a.idx - b.idx));
    layers[L] = keyed.map(o => o.id);
    layers[L].forEach((id, i) => pos.set(id, i));
  }
  for (let s = 0; s < o.iters; s++) {
    if (s % 2 === 0) { for (let L = 1; L <= maxLayer; L++) reorder(L, 'preds'); }
    else { for (let L = maxLayer - 1; L >= 0; L--) reorder(L, 'succs'); }
  }

  // Coordinates.
  let maxRows = 1;
  for (const a of layers) maxRows = Math.max(maxRows, a.length);
  const ROW = o.nodeH + o.vGap;
  const COL = o.nodeW + o.hGap;
  const coord = new Map();
  for (let L = 0; L <= maxLayer; L++) {
    const arr = layers[L];
    const off = ((maxRows - arr.length) / 2) * ROW; // vertically centre shorter layers
    arr.forEach((id, i) => {
      const isD = dummy.has(id);
      const cx = L * COL + o.nodeW / 2;
      const cy = off + i * ROW + o.nodeH / 2;
      coord.set(id, { layer: L, isDummy: isD, cx: cx, cy: cy, x: isD ? cx : L * COL, y: isD ? cy : cy - o.nodeH / 2 });
    });
  }

  // Bounding box then normalise so the component's own min is (0,0).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of coord.values()) {
    if (c.isDummy) { minX = Math.min(minX, c.cx); maxX = Math.max(maxX, c.cx); minY = Math.min(minY, c.cy); maxY = Math.max(maxY, c.cy); }
    else { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x + o.nodeW); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y + o.nodeH); }
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
// Bezier path through a chain of points (horizontal tangents).
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// createGraph(container, docs, options)
//   docs: [{ id, source, title, description, assumes:[id...], next:[id...] }]
//   options: { currentId, onOpenDoc(id) }
// Returns { destroy(), focus(id), fit(), search(query) }.
// ---------------------------------------------------------------------------
export function createGraph(container, docs, options) {
  const opts = options || {};
  const currentId = opts.currentId || null;
  const onOpenDoc = typeof opts.onOpenDoc === 'function' ? opts.onOpenDoc : function () {};

  container.classList.add('graph-root');
  container.textContent = '';

  const model = buildModel(docs || []);
  const nodeList = Array.from(model.nodes.values());
  const layout = layoutGraph(nodeList, model.edges);

  // ---- SVG scaffold ----
  const svgEl = svg('svg', { class: 'graph-svg', xmlns: SVGNS });
  const defs = svg('defs');
  defs.appendChild(marker('graph-arrow-prereq', 'graph-arrow-prereq'));
  defs.appendChild(marker('graph-arrow-recnext', 'graph-arrow-recnext'));
  svgEl.appendChild(defs);

  const viewport = svg('g', { class: 'graph-viewport' });
  const edgesG = svg('g', { class: 'graph-edges' });
  const nodesG = svg('g', { class: 'graph-nodes' });
  viewport.appendChild(edgesG);
  viewport.appendChild(nodesG);
  svgEl.appendChild(viewport);
  container.appendChild(svgEl);

  function marker(id, cls) {
    const m = svg('marker', {
      id: id, class: cls, viewBox: '0 0 10 10', refX: '9', refY: '5',
      markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse'
    });
    m.appendChild(svg('path', { d: 'M0,0 L10,5 L0,10 z' }));
    return m;
  }

  // ---- Edges ----
  for (const e of layout.edges) {
    const p = svg('path', {
      class: 'graph-edge graph-edge-' + e.type,
      d: edgePath(e.points),
      'data-from': e.from, 'data-to': e.to, 'data-type': e.type
    });
    const url = 'url(#graph-arrow-' + e.type + ')';
    if (e.head === 'start') p.setAttribute('marker-start', url);
    else p.setAttribute('marker-end', url);
    edgesG.appendChild(p);
  }

  // ---- Self loops (docs that reference themselves) ----
  for (const sl of model.selfLoops) {
    const n = layout.nodes.get(sl.id);
    if (!n) continue;
    const x0 = n.x + n.w * 0.72, y0 = n.y;
    const x1 = n.x + n.w, y1 = n.y + n.h * 0.28;
    const d = 'M ' + fmt(x0) + ' ' + fmt(y0) +
      ' C ' + fmt(x0 + 34) + ' ' + fmt(y0 - 44) + ' ' + fmt(x1 + 44) + ' ' + fmt(y1 - 34) + ' ' + fmt(x1) + ' ' + fmt(y1);
    const p = svg('path', { class: 'graph-edge graph-edge-' + sl.type, d: d, 'data-from': sl.id, 'data-to': sl.id, 'data-type': sl.type });
    p.setAttribute('marker-end', 'url(#graph-arrow-' + sl.type + ')');
    edgesG.appendChild(p);
  }

  // ---- Nodes ----
  const R = 10;
  for (const id of Array.from(model.nodes.keys()).sort()) {
    const meta = model.nodes.get(id);
    const n = layout.nodes.get(id);
    if (!n) continue;
    const cls = ['graph-node'];
    if (meta.missing) cls.push('is-missing');
    if (!meta.missing && id === currentId) cls.push('is-current');

    const g = svg('g', {
      class: cls.join(' '),
      transform: 'translate(' + fmt(n.x) + ' ' + fmt(n.y) + ')',
      'data-node-id': id,
      'data-missing': String(meta.missing)
    });
    if (!meta.missing) { g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); g.setAttribute('aria-label', meta.title); }
    else { g.setAttribute('aria-label', meta.title + ' (missing)'); }

    g.appendChild(svg('rect', { class: 'graph-node-box', width: n.w, height: n.h, rx: R, ry: R }));

    const fo = svg('foreignObject', { class: 'graph-node-fo', width: n.w, height: n.h });
    const body = document.createElement('div');
    body.className = 'graph-node-body';
    const t = document.createElement('div');
    t.className = 'graph-node-title';
    t.textContent = meta.title;
    body.appendChild(t);
    if (meta.missing) {
      const tag = document.createElement('div');
      tag.className = 'graph-node-tag';
      tag.textContent = 'missing';
      body.appendChild(tag);
    } else if (meta.desc) {
      const d = document.createElement('div');
      d.className = 'graph-node-desc';
      d.textContent = meta.desc.length > 110 ? meta.desc.slice(0, 110).trim() + '…' : meta.desc;
      body.appendChild(d);
    }
    fo.appendChild(body);
    g.appendChild(fo);
    nodesG.appendChild(g);
  }

  // ---- Overlay chrome (controls, legend, search, minimap) ----
  const controls = document.createElement('div');
  controls.className = 'graph-controls';
  const btnIn  = ctrlBtn('+', 'Zoom in');
  const btnOut = ctrlBtn('−', 'Zoom out'); // minus sign
  const btnFit = ctrlBtn('⤢', 'Fit to view');
  controls.appendChild(btnIn); controls.appendChild(btnOut); controls.appendChild(btnFit);
  container.appendChild(controls);

  const searchWrap = document.createElement('div');
  searchWrap.className = 'graph-search';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Find a document…';
  searchInput.setAttribute('aria-label', 'Find a document in the map');
  searchInput.autocomplete = 'off';
  searchWrap.appendChild(searchInput);
  container.appendChild(searchWrap);

  const legend = document.createElement('div');
  legend.className = 'graph-legend';
  legend.innerHTML =
    '<span class="graph-legend-item"><span class="graph-legend-swatch prereq"></span>Prerequisite</span>' +
    '<span class="graph-legend-item"><span class="graph-legend-swatch recnext"></span>Recommended next</span>' +
    '<span class="graph-legend-item"><span class="graph-legend-swatch missing"></span>Missing</span>';
  container.appendChild(legend);

  // Minimap (small, best-effort; never allowed to break the main view).
  const mini = document.createElement('div');
  mini.className = 'graph-minimap';
  const miniSvg = svg('svg', { class: 'graph-minimap-svg' });
  const miniNodes = svg('g');
  const miniView = svg('rect', { class: 'graph-minimap-view' });
  miniSvg.appendChild(miniNodes);
  miniSvg.appendChild(miniView);
  mini.appendChild(miniSvg);
  container.appendChild(mini);

  const MINI_W = 168, MINI_H = 120, MINI_PAD = 6;
  let miniScale = 1, miniOX = 0, miniOY = 0;
  function buildMinimap() {
    try {
      miniNodes.textContent = '';
      const cw = layout.width || 1, ch = layout.height || 1;
      miniScale = Math.min((MINI_W - MINI_PAD * 2) / cw, (MINI_H - MINI_PAD * 2) / ch);
      if (!isFinite(miniScale) || miniScale <= 0) miniScale = 1;
      miniOX = (MINI_W - cw * miniScale) / 2;
      miniOY = (MINI_H - ch * miniScale) / 2;
      miniSvg.setAttribute('viewBox', '0 0 ' + MINI_W + ' ' + MINI_H);
      for (const id of model.nodes.keys()) {
        const n = layout.nodes.get(id);
        if (!n) continue;
        const meta = model.nodes.get(id);
        miniNodes.appendChild(svg('rect', {
          class: 'graph-minimap-node' + (meta.missing ? ' is-missing' : (id === currentId ? ' is-current' : '')),
          x: fmt(miniOX + n.x * miniScale), y: fmt(miniOY + n.y * miniScale),
          width: fmt(n.w * miniScale), height: fmt(n.h * miniScale), rx: 1.5
        }));
      }
    } catch (err) { /* minimap is decorative; ignore */ }
  }
  function updateMinimap() {
    try {
      const rect = svgEl.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      if (!w || !h) return;
      const vx = -tx / k, vy = -ty / k, vw = w / k, vh = h / k;
      miniView.setAttribute('x', fmt(miniOX + vx * miniScale));
      miniView.setAttribute('y', fmt(miniOY + vy * miniScale));
      miniView.setAttribute('width', fmt(vw * miniScale));
      miniView.setAttribute('height', fmt(vh * miniScale));
    } catch (err) { /* ignore */ }
  }

  function ctrlBtn(label, aria) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'graph-ctrl-btn';
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    b.title = aria;
    return b;
  }

  // ---- Empty state ----
  if (model.nodes.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'graph-empty';
    empty.textContent = 'No documents to map.';
    container.appendChild(empty);
  }

  // ---- Transform state + application ----
  let tx = 0, ty = 0, k = 1;
  function applyTransform() {
    viewport.setAttribute('transform', 'translate(' + fmt(tx) + ' ' + fmt(ty) + ') scale(' + fmt(k) + ')');
    viewport.setAttribute('data-scale', fmt(k));
    viewport.setAttribute('data-tx', fmt(tx));
    viewport.setAttribute('data-ty', fmt(ty));
    updateMinimap();
  }

  function viewSize() {
    const rect = svgEl.getBoundingClientRect();
    return { w: rect.width || container.clientWidth || 0, h: rect.height || container.clientHeight || 0, rect: rect };
  }

  function fit() {
    const vs = viewSize();
    const cw = layout.width, ch = layout.height;
    if (cw <= 0 || ch <= 0 || vs.w <= 0 || vs.h <= 0) {
      k = 1; tx = vs.w / 2; ty = vs.h / 2; applyTransform(); return;
    }
    k = clamp(Math.min(vs.w / cw, vs.h / ch) * 0.9, MIN_K, MAX_K);
    tx = (vs.w - cw * k) / 2;
    ty = (vs.h - ch * k) / 2;
    applyTransform();
  }

  function zoomAround(px, py, factor) {
    const wx = (px - tx) / k, wy = (py - ty) / k;
    const nk = clamp(k * factor, MIN_K, MAX_K);
    tx = px - wx * nk; ty = py - wy * nk; k = nk;
    applyTransform();
  }
  function zoomCenter(factor) {
    const vs = viewSize();
    zoomAround(vs.w / 2, vs.h / 2, factor);
  }

  let flashTimer = null;
  function flash(id) {
    const g = nodesG.querySelector('[data-node-id="' + cssEscape(id) + '"]');
    if (!g) return;
    nodesG.querySelectorAll('.is-found').forEach(x => x.classList.remove('is-found'));
    g.classList.add('is-found');
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { g.classList.remove('is-found'); }, 1800);
  }

  function focus(id) {
    const n = layout.nodes.get(id);
    if (!n) return false;
    const vs = viewSize();
    tx = vs.w / 2 - n.cx * k;
    ty = vs.h / 2 - n.cy * k;
    applyTransform();
    flash(id);
    return true;
  }

  // Ordered id list for deterministic search.
  const sortedIds = Array.from(model.nodes.keys()).sort();
  function search(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return null;
    let starts = null, includes = null;
    for (const id of sortedIds) {
      const meta = model.nodes.get(id);
      const title = (meta.title || '').toLowerCase();
      const lid = id.toLowerCase();
      if (title === q || lid === q) { focus(id); return id; }
      if (starts === null && (title.indexOf(q) === 0 || lid.indexOf(q) === 0)) starts = id;
      if (includes === null && (title.indexOf(q) !== -1 || lid.indexOf(q) !== -1)) includes = id;
    }
    const hit = starts || includes;
    if (hit) { focus(hit); return hit; }
    return null;
  }

  // ---- Interaction wiring ----
  const listeners = [];
  function on(target, type, fn, opt) { target.addEventListener(type, fn, opt); listeners.push({ target: target, type: type, fn: fn, opt: opt }); }

  let dragging = false, moved = false, sx = 0, sy = 0, sTx = 0, sTy = 0;
  on(svgEl, 'pointerdown', function (e) {
    if (e.button !== 0) return;
    dragging = true; moved = false;
    sx = e.clientX; sy = e.clientY; sTx = tx; sTy = ty;
    svgEl.classList.add('is-panning');
    try { svgEl.setPointerCapture(e.pointerId); } catch (err) {}
  });
  on(svgEl, 'pointermove', function (e) {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) moved = true;
    if (moved) { tx = sTx + dx; ty = sTy + dy; applyTransform(); }
  });
  on(svgEl, 'pointerup', function (e) {
    if (!dragging) return;
    dragging = false;
    svgEl.classList.remove('is-panning');
    try { svgEl.releasePointerCapture(e.pointerId); } catch (err) {}
    if (!moved) {
      const g = e.target && e.target.closest ? e.target.closest('.graph-node') : null;
      if (g && g.getAttribute('data-missing') !== 'true') {
        const id = g.getAttribute('data-node-id');
        if (id) onOpenDoc(id);
      }
    }
  });
  on(svgEl, 'pointercancel', function () { dragging = false; svgEl.classList.remove('is-panning'); });

  on(svgEl, 'wheel', function (e) {
    e.preventDefault();
    const rect = svgEl.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAround(px, py, factor);
  }, { passive: false });

  // Keyboard: Enter/Space activates a focused node.
  on(nodesG, 'keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const g = e.target && e.target.closest ? e.target.closest('.graph-node') : null;
    if (g && g.getAttribute('data-missing') !== 'true') {
      e.preventDefault();
      const id = g.getAttribute('data-node-id');
      if (id) onOpenDoc(id);
    }
  });

  on(btnIn, 'click', function () { zoomCenter(1.25); });
  on(btnOut, 'click', function () { zoomCenter(1 / 1.25); });
  on(btnFit, 'click', function () { fit(); });

  on(searchInput, 'input', function () { search(searchInput.value); });
  on(searchInput, 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(searchInput.value); } });

  // Click the minimap to recentre.
  on(miniSvg, 'click', function (e) {
    try {
      const rect = miniSvg.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (MINI_W / rect.width);
      const my = (e.clientY - rect.top) * (MINI_H / rect.height);
      const wx = (mx - miniOX) / miniScale, wy = (my - miniOY) / miniScale;
      const vs = viewSize();
      tx = vs.w / 2 - wx * k; ty = vs.h / 2 - wy * k;
      applyTransform();
    } catch (err) {}
  });

  // Fit once the container actually has a size (handles being opened in a
  // hidden overlay that becomes visible after createGraph runs).
  let fitted = false;
  buildMinimap();
  const vs0 = viewSize();
  if (vs0.w > 0 && vs0.h > 0) { fit(); fitted = true; }
  else { applyTransform(); }

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(function () {
      const vs = viewSize();
      if (!fitted && vs.w > 0 && vs.h > 0) { fit(); fitted = true; }
      else updateMinimap();
    });
    ro.observe(container);
  }

  // Focus/centre the current doc if there is one (after fit so it wins).
  if (currentId && layout.nodes.has(currentId)) {
    // keep the fitted overview but ensure the current node is flagged; only
    // recentre if the graph is large enough that the current node might be off.
    flash(currentId);
  }

  function destroy() {
    for (const l of listeners) { try { l.target.removeEventListener(l.type, l.fn, l.opt); } catch (err) {} }
    listeners.length = 0;
    if (ro) { try { ro.disconnect(); } catch (err) {} ro = null; }
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    container.textContent = '';
    container.classList.remove('graph-root');
  }

  return { destroy: destroy, focus: focus, fit: fit, search: search };
}

function cssEscape(id) {
  return (window.CSS && CSS.escape) ? CSS.escape(id) : String(id).replace(/([^\w-])/g, '\\$1');
}
