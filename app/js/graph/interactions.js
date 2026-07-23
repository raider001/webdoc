// graph/interactions.js - all pointer / wheel / keyboard wiring, the control +
// search + minimap bindings, the one-time fit/flash init, and destroy(). Pointer
// gesture bookkeeping stays local; only the live transform (g.tx/g.ty/g.k) and the
// view/edit callbacks are read off the shared context `g`. Sets g.destroy.
import { DRAG_THRESHOLD, MINI_W, MINI_H } from './util.js';

export function wireInteractions(g) {
  const listeners = [];
  function on(target, type, fn, opt) { target.addEventListener(type, fn, opt); listeners.push({ target: target, type: type, fn: fn, opt: opt }); }

  const svgEl = g.svgEl, nodesG = g.nodesG;

  let dragging = false, moved = false, sx = 0, sy = 0, sTx = 0, sTy = 0;
  let lastClickId = null, lastClickTime = 0, downNodeId = null, downExtUrl = null, downEdge = null;
  on(svgEl, 'pointerdown', function (e) {
    if (e.button !== 0) return;
    // Record the pressed node NOW: setPointerCapture (below) retargets the later
    // pointerup to the SVG root, so we can't read the node from pointerup.target.
    const dg = e.target && e.target.closest ? e.target.closest('.graph-node') : null;
    downNodeId = (dg && dg.getAttribute('data-missing') !== 'true') ? dg.getAttribute('data-node-id') : null;
    downExtUrl = dg ? dg.getAttribute('data-external-url') : null;
    const de = (!dg && e.target && e.target.closest) ? e.target.closest('.graph-edge-hit') : null;
    downEdge = de ? { from: de.getAttribute('data-from'), to: de.getAttribute('data-to'), type: de.getAttribute('data-type') } : null;
    dragging = true; moved = false;
    sx = e.clientX; sy = e.clientY; sTx = g.tx; sTy = g.ty;
    svgEl.classList.add('is-panning');
    try { svgEl.setPointerCapture(e.pointerId); } catch (err) {}
  });
  on(svgEl, 'pointermove', function (e) {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) moved = true;
    if (moved) { g.tx = sTx + dx; g.ty = sTy + dy; g.applyTransform(); }
  });
  on(svgEl, 'pointerup', function (e) {
    if (!dragging) return;
    dragging = false;
    svgEl.classList.remove('is-panning');
    try { svgEl.releasePointerCapture(e.pointerId); } catch (err) {}
    if (!moved && g.editMode) {
      // Edit mode: click node A then node B to connect; click a line to select it.
      if (downNodeId) {
        if (!g.pendingSource) { g.markSource(downNodeId); g.clearSelectedEdge(); g.updateHint(); }
        else if (g.pendingSource === downNodeId) { g.clearPending(); g.updateHint(); }
        else { const s = g.pendingSource, t = downNodeId; g.clearPending(); if (g.onConnect) g.onConnect(s, t, g.activeConnector); }
      } else if (downEdge) {
        g.selectEdge(downEdge.from, downEdge.to, downEdge.type);
      } else {
        g.clearPending(); g.clearSelectedEdge(); g.updateHint();
      }
      downNodeId = null; downExtUrl = null; downEdge = null;
      return;
    }
    if (!moved && downExtUrl) {
      window.open(downExtUrl, '_blank', 'noopener'); // external link box -> new tab
    } else if (!moved && downNodeId) {
      const id = downNodeId;
      const now = Date.now();
      if (lastClickId === id && (now - lastClickTime) < 350) {
        lastClickId = null;
        g.onActivate(id);           // double click -> open the doc and leave the map
      } else {
        lastClickId = id; lastClickTime = now;
        g.setCurrent(id);
        g.onSelect(id);             // single click -> select it, stay on the map
      }
    }
    downNodeId = null; downExtUrl = null; downEdge = null;
  });
  on(svgEl, 'pointercancel', function () { dragging = false; svgEl.classList.remove('is-panning'); });

  on(svgEl, 'wheel', function (e) {
    e.preventDefault();
    const rect = svgEl.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    g.zoomAround(px, py, factor);
  }, { passive: false });

  // Keyboard: Enter/Space activates a focused node.
  on(nodesG, 'keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const gEl = e.target && e.target.closest ? e.target.closest('.graph-node') : null;
    if (!gEl) return;
    const extUrl = gEl.getAttribute('data-external-url');
    if (extUrl) { e.preventDefault(); window.open(extUrl, '_blank', 'noopener'); return; }
    if (gEl.getAttribute('data-missing') !== 'true') {
      e.preventDefault();
      const id = gEl.getAttribute('data-node-id');
      if (id) { g.setCurrent(id); g.onSelect(id); }
    }
  });

  // Edit mode keys: Delete removes the selected connection; Escape cancels a
  // pending connect / selection (capture phase, so it pre-empts the overlay close).
  on(document, 'keydown', function (e) {
    if (!g.editMode) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (g.selectedEdge && g.onDisconnect) {
        e.preventDefault();
        const se = g.selectedEdge; g.clearSelectedEdge(); g.updateHint();
        g.onDisconnect(se.from, se.to, se.type);
      }
    } else if (e.key === 'Escape' && (g.pendingSource || g.selectedEdge)) {
      e.preventDefault(); e.stopPropagation();
      g.clearPending(); g.clearSelectedEdge(); g.updateHint();
    }
  }, true);

  // Delete key: delete the currently-selected DOCUMENT (doc map only; the app
  // wires g.onDelete to confirm + remove the file). Skips text fields and any
  // in-flight edit-mode edge deletion / connect (handled by the block above).
  on(document, 'keydown', function (e) {
    if (e.key !== 'Delete') return;
    if (!g.onDelete) return;
    if (g.editMode && (g.selectedEdge || g.pendingSource)) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
    const id = g.currentId;
    if (!id || !g.layout.nodes.has(id)) return;   // need a real, laid-out node selected
    e.preventDefault();
    g.onDelete(id);
  });

  on(g.btnIn, 'click', function () { g.zoomCenter(1.25); });
  on(g.btnOut, 'click', function () { g.zoomCenter(1 / 1.25); });
  on(g.btnFit, 'click', function () { g.fit(); });

  on(g.searchInput, 'input', function () { g.search(g.searchInput.value); });
  on(g.searchInput, 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); g.search(g.searchInput.value); } });

  // Click the minimap to recentre.
  on(g.miniSvg, 'click', function (e) {
    try {
      const rect = g.miniSvg.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (MINI_W / rect.width);
      const my = (e.clientY - rect.top) * (MINI_H / rect.height);
      const wx = (mx - g.miniOX) / g.miniScale, wy = (my - g.miniOY) / g.miniScale;
      const vs = g.viewSize();
      g.tx = vs.w / 2 - wx * g.k; g.ty = vs.h / 2 - wy * g.k;
      g.applyTransform();
    } catch (err) {}
  });

  // Fit once the container actually has a size (handles being opened in a
  // hidden overlay that becomes visible after createGraph runs).
  g.buildMinimap();
  const vs0 = g.viewSize();
  const it = g.opts.initialTransform;
  if (it && isFinite(it.k) && isFinite(it.tx) && isFinite(it.ty)) {
    g.tx = it.tx; g.ty = it.ty; g.k = it.k; g.applyTransform(); g.fitted = true;   // restore prior view (post-edit rebuild)
  } else if (vs0.w > 0 && vs0.h > 0) { g.fit(); g.fitted = true; }
  else { g.applyTransform(); }

  if (typeof ResizeObserver !== 'undefined') {
    g.ro = new ResizeObserver(function () {
      const vs = g.viewSize();
      if (!g.fitted && vs.w > 0 && vs.h > 0) { g.fit(); g.fitted = true; }
      else g.updateMinimap();
    });
    g.ro.observe(g.container);
  }

  // Focus/centre the current doc if there is one (after fit so it wins).
  if (g.currentId && g.layout.nodes.has(g.currentId)) {
    // keep the fitted overview but ensure the current node is flagged.
    g.flash(g.currentId);
  }

  g.destroy = function () {
    for (const l of listeners) { try { l.target.removeEventListener(l.type, l.fn, l.opt); } catch (err) {} }
    listeners.length = 0;
    if (g.ro) { try { g.ro.disconnect(); } catch (err) {} g.ro = null; }
    if (g.flashTimer) { clearTimeout(g.flashTimer); g.flashTimer = null; }
    g.container.textContent = '';
    g.container.classList.remove('graph-root');
  };
}
