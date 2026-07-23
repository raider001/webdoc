// graph/view.js - the viewport: pan/zoom transform state, fit, wheel/button zoom
// math, node focus + flash, the "current" highlight, search, and the minimap
// render/update. All functions are attached onto the shared context `g` and read
// or write g.tx / g.ty / g.k (the live transform).
import { svg, clamp, fmt, cssEscape, MIN_K, MAX_K, MINI_W, MINI_H, MINI_PAD } from './util.js';

export function attachView(g) {
  g.viewSize = function () {
    const rect = g.svgEl.getBoundingClientRect();
    return { w: rect.width || g.container.clientWidth || 0, h: rect.height || g.container.clientHeight || 0, rect: rect };
  };

  g.updateMinimap = function () {
    try {
      const rect = g.svgEl.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      if (!w || !h) return;
      const vx = -g.tx / g.k, vy = -g.ty / g.k, vw = w / g.k, vh = h / g.k;
      g.miniView.setAttribute('x', fmt(g.miniOX + vx * g.miniScale));
      g.miniView.setAttribute('y', fmt(g.miniOY + vy * g.miniScale));
      g.miniView.setAttribute('width', fmt(vw * g.miniScale));
      g.miniView.setAttribute('height', fmt(vh * g.miniScale));
    } catch (err) { /* ignore */ }
  };

  g.applyTransform = function () {
    g.viewport.setAttribute('transform', 'translate(' + fmt(g.tx) + ' ' + fmt(g.ty) + ') scale(' + fmt(g.k) + ')');
    g.viewport.setAttribute('data-scale', fmt(g.k));
    g.viewport.setAttribute('data-tx', fmt(g.tx));
    g.viewport.setAttribute('data-ty', fmt(g.ty));
    g.updateMinimap();
  };

  g.fit = function () {
    const vs = g.viewSize();
    const cw = g.layout.width, ch = g.layout.height;
    if (cw <= 0 || ch <= 0 || vs.w <= 0 || vs.h <= 0) {
      g.k = 1; g.tx = vs.w / 2; g.ty = vs.h / 2; g.applyTransform(); return;
    }
    g.k = clamp(Math.min(vs.w / cw, vs.h / ch) * 0.9, MIN_K, MAX_K);
    g.tx = (vs.w - cw * g.k) / 2;
    g.ty = (vs.h - ch * g.k) / 2;
    g.applyTransform();
  };

  g.zoomAround = function (px, py, factor) {
    const wx = (px - g.tx) / g.k, wy = (py - g.ty) / g.k;
    const nk = clamp(g.k * factor, MIN_K, MAX_K);
    g.tx = px - wx * nk; g.ty = py - wy * nk; g.k = nk;
    g.applyTransform();
  };
  g.zoomCenter = function (factor) {
    const vs = g.viewSize();
    g.zoomAround(vs.w / 2, vs.h / 2, factor);
  };

  g.flash = function (id) {
    const gEl = g.nodesG.querySelector('[data-node-id="' + cssEscape(id) + '"]');
    if (!gEl) return;
    g.nodesG.querySelectorAll('.is-found').forEach(x => x.classList.remove('is-found'));
    gEl.classList.add('is-found');
    if (g.flashTimer) clearTimeout(g.flashTimer);
    g.flashTimer = setTimeout(() => { gEl.classList.remove('is-found'); }, 1800);
  };

  g.focus = function (id) {
    const n = g.layout.nodes.get(id);
    if (!n) return false;
    const vs = g.viewSize();
    g.tx = vs.w / 2 - n.cx * g.k;
    g.ty = vs.h / 2 - n.cy * g.k;
    g.applyTransform();
    g.flash(id);
    return true;
  };

  // Move the "current" highlight to a node (used when selecting on the map).
  g.setCurrent = function (id) {
    g.currentId = id;
    g.nodesG.querySelectorAll('.graph-node.is-current').forEach(x => x.classList.remove('is-current'));
    const gEl = g.nodesG.querySelector('[data-node-id="' + cssEscape(id) + '"]');
    if (gEl && gEl.getAttribute('data-missing') !== 'true') gEl.classList.add('is-current');
    g.buildMinimap(); // rebuilds minimap nodes with the new current flag
  };

  g.search = function (query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return null;
    let starts = null, includes = null;
    for (const id of g.sortedIds) {
      const meta = g.model.nodes.get(id);
      const title = (meta.title || '').toLowerCase();
      const lid = id.toLowerCase();
      if (title === q || lid === q) { g.focus(id); return id; }
      if (starts === null && (title.indexOf(q) === 0 || lid.indexOf(q) === 0)) starts = id;
      if (includes === null && (title.indexOf(q) !== -1 || lid.indexOf(q) !== -1)) includes = id;
    }
    const hit = starts || includes;
    if (hit) { g.focus(hit); return hit; }
    return null;
  };

  g.buildMinimap = function () {
    try {
      g.miniNodes.textContent = '';
      const cw = g.layout.width || 1, ch = g.layout.height || 1;
      g.miniScale = Math.min((MINI_W - MINI_PAD * 2) / cw, (MINI_H - MINI_PAD * 2) / ch);
      if (!isFinite(g.miniScale) || g.miniScale <= 0) g.miniScale = 1;
      g.miniOX = (MINI_W - cw * g.miniScale) / 2;
      g.miniOY = (MINI_H - ch * g.miniScale) / 2;
      g.miniSvg.setAttribute('viewBox', '0 0 ' + MINI_W + ' ' + MINI_H);
      for (const id of g.model.nodes.keys()) {
        const n = g.layout.nodes.get(id);
        if (!n) continue;
        const meta = g.model.nodes.get(id);
        g.miniNodes.appendChild(svg('rect', {
          class: 'graph-minimap-node' + (meta.missing ? ' is-missing' : (id === g.currentId ? ' is-current' : '')),
          x: fmt(g.miniOX + n.x * g.miniScale), y: fmt(g.miniOY + n.y * g.miniScale),
          width: fmt(n.w * g.miniScale), height: fmt(n.h * g.miniScale), rx: 1.5
        }));
      }
    } catch (err) { /* minimap is decorative; ignore */ }
  };
}
