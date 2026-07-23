// graph/render.js - builds the SVG scene from the model + layout: the scaffold
// (defs/markers, viewport, edge + node groups), every edge (prereq/recnext with
// selectable hit targets, self-loops, requirement-trace and page-link overlays),
// document nodes, and external-link boxes. Also the uniform node-sizing pass and
// external-node placement. All output goes onto the shared context `g`.
import { SVGNS, LO, svg, clamp, fmt, edgePath } from './util.js';

// A test case is pass/fail/untested; a requirement shows its % passing.
function covLabel(st, kind) {
  if (kind === 'test') return st.status === 'pass' ? 'Pass' : st.status === 'fail' ? 'Fail' : st.status === 'partial' ? 'Partial' : 'Untested';
  return (st.pct === null || st.pct === undefined) ? 'untested' : (st.pct + '% passing');
}

// Uniform auto-sizing (opts.autoSize): measure every node's real content and
// pick ONE box size big enough for the largest, so nothing is clipped and all
// boxes match. Runs inside `container` so the live CSS (fonts, the coverage
// overlay's monospace titles and un-clamped text) is what gets measured.
export function computeNodeSize(g) {
  const meas = document.createElement('div');
  meas.style.cssText = 'position:absolute; visibility:hidden; left:-99999px; top:0; pointer-events:none;';
  g.container.appendChild(meas);
  try {
    let titleW = 0;                                     // widest single-line title -> box width
    for (const meta of g.model.nodes.values()) {
      const t = document.createElement('div');
      t.className = 'graph-node-title';
      t.style.cssText = 'white-space:nowrap; display:inline-block;';
      t.textContent = meta.title;
      meas.appendChild(t); titleW = Math.max(titleW, t.offsetWidth); meas.removeChild(t);
    }
    const W = clamp(Math.ceil(titleW) + 34, LO.nodeW, g.opts.maxNodeW || 360);
    let H = 0;                                          // tallest full body at that width -> box height
    for (const meta of g.model.nodes.values()) {
      const body = document.createElement('div');
      body.className = 'graph-node-body';
      body.style.cssText = 'width:' + W + 'px; height:auto; box-sizing:border-box;';
      const t = document.createElement('div'); t.className = 'graph-node-title'; t.textContent = meta.title; body.appendChild(t);
      const st = g.statusOf(meta.id);
      if (st) { const c = document.createElement('div'); c.className = 'graph-node-cov'; c.textContent = covLabel(st, g.kindOf(meta.id)); body.appendChild(c); }
      if (meta.missing) { const gg = document.createElement('div'); gg.className = 'graph-node-tag'; gg.textContent = 'missing'; body.appendChild(gg); }
      else if (meta.desc) { const d = document.createElement('div'); d.className = 'graph-node-desc'; d.textContent = meta.desc.length > 110 ? meta.desc.slice(0, 110).trim() + '…' : meta.desc; body.appendChild(d); }
      meas.appendChild(body); H = Math.max(H, body.offsetHeight); meas.removeChild(body);
    }
    return { nodeW: W, nodeH: clamp(Math.ceil(H) + 4, LO.nodeH, g.opts.maxNodeH || 240) };
  } finally { g.container.removeChild(meas); }
}

// Position external-link nodes in a column to the right of the doc layout, then
// extend the layout bounds so fit()/minimap frame them too. Sets g.extPos and
// g.nodePos (resolves either a doc node or an external node by id).
export function positionExternal(g) {
  const extPos = new Map();
  const layout = g.layout;
  if (g.externalNodes.length) {
    const EXT_W = 172, EXT_H = 46, DROP = 44;
    // Which source doc(s) link to each external node.
    const srcOf = new Map();
    for (const pl of g.pageLinks) {
      if (String(pl.to).indexOf('ext:') === 0) {
        if (!srcOf.has(pl.to)) srcOf.set(pl.to, []);
        srcOf.get(pl.to).push(pl.from);
      }
    }
    const PAD = 16;
    // An external box must never sit on a document node or another external box.
    const hits = (x, y) => {
      for (const [, n] of layout.nodes)
        if (x < n.x + n.w + PAD && x + EXT_W + PAD > n.x && y < n.y + n.h + PAD && y + EXT_H + PAD > n.y) return true;
      for (const [, p] of extPos)
        if (x < p.x + p.w + PAD && x + EXT_W + PAD > p.x && y < p.y + p.h + PAD && y + EXT_H + PAD > p.y) return true;
      return false;
    };
    // Nearest collision-free box position to a preferred anchor, searched in
    // rings of increasing radius (any direction), kept in the positive quadrant.
    const STEP = 20, MAXR = 120;
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
        ? nearestFree(src.x + src.w / 2 - EXT_W / 2, src.y + src.h + DROP) // prefer just below the source
        : { x: 0, y: layout.height + 60 };
      extPos.set(en.id, { x: pos.x, y: pos.y, w: EXT_W, h: EXT_H });
      layout.width = Math.max(layout.width, pos.x + EXT_W);
      layout.height = Math.max(layout.height, pos.y + EXT_H);
    }
  }
  g.extPos = extPos;
  g.nodePos = (id) => layout.nodes.get(id) || extPos.get(id) || null;
}

function marker(id, cls) {
  const m = svg('marker', {
    id: id, class: cls, viewBox: '0 0 10 10', refX: '9', refY: '5',
    markerWidth: '9', markerHeight: '9', orient: 'auto-start-reverse'
  });
  m.appendChild(svg('path', { d: 'M0,0 L10,5 L0,10 z' }));
  return m;
}

export function renderScene(g) {
  const model = g.model, layout = g.layout;

  // ---- SVG scaffold ----
  const svgEl = svg('svg', { class: 'graph-svg', xmlns: SVGNS });
  const defs = svg('defs');
  defs.appendChild(marker('graph-arrow-prereq', 'graph-arrow-prereq'));
  defs.appendChild(marker('graph-arrow-recnext', 'graph-arrow-recnext'));
  defs.appendChild(marker('graph-arrow-trace', 'graph-arrow-trace'));
  defs.appendChild(marker('graph-arrow-pagelink', 'graph-arrow-pagelink'));
  svgEl.appendChild(defs);

  const viewport = svg('g', { class: 'graph-viewport' });
  const edgesG = svg('g', { class: 'graph-edges' });
  const nodesG = svg('g', { class: 'graph-nodes' });
  viewport.appendChild(edgesG);
  viewport.appendChild(nodesG);
  svgEl.appendChild(viewport);
  g.container.appendChild(svgEl);
  g.svgEl = svgEl; g.viewport = viewport; g.edgesG = edgesG; g.nodesG = nodesG;

  // Focus view: draw ONLY the edges that touch the focused node itself (the rays
  // of the sun-burst). Every other line - between neighbours or out to distant
  // nodes - is hidden.
  const edgeShown = (from, to) => !g.focusId || from === g.focusId || to === g.focusId;

  // ---- Edges ----
  function touchesMissing(from, to) {
    const a = model.nodes.get(from), b = model.nodes.get(to);
    return (a && a.missing) || (b && b.missing);
  }
  // Draw prerequisite edges first so they always sit BELOW every other line
  // (recommended-next here, plus the trace/page-link edges drawn further below).
  const orderedEdges = layout.edges.slice().sort(
    (a, b) => (a.type === 'prereq' ? 0 : 1) - (b.type === 'prereq' ? 0 : 1));
  for (const e of orderedEdges) {
    if (!edgeShown(e.from, e.to)) continue;
    const p = svg('path', {
      class: 'graph-edge graph-edge-' + e.type + (touchesMissing(e.from, e.to) ? ' graph-edge-tomissing' : ''),
      d: edgePath(e.points),
      'data-from': e.from, 'data-to': e.to, 'data-type': e.type
    });
    const url = 'url(#graph-arrow-' + e.type + ')';
    // Prerequisite edges point AT the prerequisite (D -> P reads "D requires P"),
    // so invert the arrowhead end for this type only.
    let head = e.head;
    if (e.type === 'prereq') head = (head === 'start') ? 'end' : 'start';
    if (head === 'start') p.setAttribute('marker-start', url);
    else p.setAttribute('marker-end', url);
    edgesG.appendChild(p);
    // Register + add a wide transparent hit target so the edge is selectable
    // in edit mode (the visible stroke is only ~2px wide).
    g.editEdgeEls.set(e.from + '|' + e.type + '|' + e.to, p);
    edgesG.appendChild(svg('path', {
      class: 'graph-edge-hit', d: edgePath(e.points),
      'data-from': e.from, 'data-to': e.to, 'data-type': e.type
    }));
  }

  // ---- Self loops (docs that reference themselves) ----
  for (const sl of model.selfLoops) {
    if (!edgeShown(sl.id, sl.id)) continue;
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

  // ---- Requirement-trace edges (overlay; do NOT affect the hierarchy layout) ----
  // Each {from,to} means a requirement in `from` traces to one in `to`.
  function borderPoint(n, towardX, towardY) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    const dx = towardX - cx, dy = towardY - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const sx = dx !== 0 ? (n.w / 2) / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? (n.h / 2) / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }
  for (const te of g.traceEdges) {
    if (!edgeShown(te.from, te.to)) continue;
    const a = layout.nodes.get(te.from), b = layout.nodes.get(te.to);
    if (!a || !b) continue;
    const p0 = borderPoint(a, b.x + b.w / 2, b.y + b.h / 2);
    const p1 = borderPoint(b, a.x + a.w / 2, a.y + a.h / 2);
    const path = svg('path', {
      class: 'graph-edge graph-edge-trace',
      d: 'M ' + fmt(p0.x) + ' ' + fmt(p0.y) + ' L ' + fmt(p1.x) + ' ' + fmt(p1.y),
      'data-from': te.from, 'data-to': te.to, 'data-type': 'trace'
    });
    path.setAttribute('marker-end', 'url(#graph-arrow-trace)');
    edgesG.appendChild(path);
  }

  // ---- Page-link edges (overlay): in-body links, incl. to external nodes ----
  for (const pl of g.pageLinks) {
    if (!edgeShown(pl.from, pl.to)) continue;
    const a = g.nodePos(pl.from), b = g.nodePos(pl.to);
    if (!a || !b) continue;
    const p0 = borderPoint(a, b.x + b.w / 2, b.y + b.h / 2);
    const p1 = borderPoint(b, a.x + a.w / 2, a.y + a.h / 2);
    const path = svg('path', {
      class: 'graph-edge graph-edge-pagelink',
      d: 'M ' + fmt(p0.x) + ' ' + fmt(p0.y) + ' L ' + fmt(p1.x) + ' ' + fmt(p1.y),
      'data-from': pl.from, 'data-to': pl.to, 'data-type': 'pagelink'
    });
    path.setAttribute('marker-end', 'url(#graph-arrow-pagelink)');
    edgesG.appendChild(path);
  }

  // ---- Nodes ----
  const R = 10;
  for (const id of Array.from(model.nodes.keys()).sort()) {
    const meta = model.nodes.get(id);
    const n = layout.nodes.get(id);
    if (!n) continue;
    const cls = ['graph-node'];
    if (meta.missing) cls.push('is-missing');
    if (!meta.missing && id === g.currentId) cls.push('is-current');
    const st = g.statusOf(id);
    if (st) cls.push('graph-node-st-' + st.status);
    const kind = g.kindOf(id);
    if (kind) cls.push('graph-node-kind-' + kind);

    const gEl = svg('g', {
      class: cls.join(' '),
      transform: 'translate(' + fmt(n.x) + ' ' + fmt(n.y) + ')',
      'data-node-id': id,
      'data-missing': String(meta.missing)
    });
    if (!meta.missing) { gEl.setAttribute('tabindex', '0'); gEl.setAttribute('role', 'button'); gEl.setAttribute('aria-label', meta.title); }
    else { gEl.setAttribute('aria-label', meta.title + ' (missing)'); }

    gEl.appendChild(svg('rect', { class: 'graph-node-box', width: n.w, height: n.h, rx: R, ry: R }));

    const fo = svg('foreignObject', { class: 'graph-node-fo', width: n.w, height: n.h });
    const body = document.createElement('div');
    body.className = 'graph-node-body';
    const t = document.createElement('div');
    t.className = 'graph-node-title';
    t.textContent = meta.title;
    body.appendChild(t);
    if (st) {
      const cov = document.createElement('div');
      cov.className = 'graph-node-cov';
      cov.textContent = covLabel(st, kind);
      body.appendChild(cov);
    }
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
    gEl.appendChild(fo);
    nodesG.appendChild(gEl);
  }

  // ---- External-link nodes: a URL box with a "?" bubble in the corner ----
  for (const en of g.externalNodes) {
    const pos = g.extPos.get(en.id);
    if (!pos) continue;
    const gEl = svg('g', {
      class: 'graph-node graph-ext-node',
      transform: 'translate(' + fmt(pos.x) + ' ' + fmt(pos.y) + ')',
      'data-node-id': en.id, 'data-missing': 'true', 'data-external-url': en.url
    });
    gEl.setAttribute('aria-label', 'External link (opens in a new tab): ' + en.url);
    gEl.setAttribute('tabindex', '0');
    gEl.setAttribute('role', 'link');
    gEl.appendChild(svg('rect', { class: 'graph-ext-box', width: pos.w, height: pos.h, rx: R, ry: R }));
    const fo = svg('foreignObject', { class: 'graph-node-fo', width: pos.w, height: pos.h });
    const body = document.createElement('div');
    body.className = 'graph-ext-body';
    const u = document.createElement('div');
    u.className = 'graph-ext-url';
    u.textContent = en.url;
    body.appendChild(u);
    fo.appendChild(body);
    gEl.appendChild(fo);
    // "?" bubble, top-right corner - signifies an external destination.
    const bubble = svg('g', { class: 'graph-ext-bubble', transform: 'translate(' + fmt(pos.w - 8) + ' 8)' });
    bubble.appendChild(svg('circle', { r: '8.5' }));
    const q = svg('text', { x: '0', y: '0.5', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    q.textContent = '?';
    bubble.appendChild(q);
    gEl.appendChild(bubble);
    nodesG.appendChild(gEl);
  }
}
