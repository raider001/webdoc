// graph/view.ts - the viewport for the CANVAS scene: pan/zoom transform state,
// fit, wheel/button zoom math, node focus + flash, the "current" highlight, search,
// and the minimap (its own small canvas). All functions attach onto the shared
// context `g` and read/write g.tx / g.ty / g.k. Nothing here touches per-node DOM
// anymore - highlight/flash/current are draw STATE that render.js consults each
// frame; applyTransform just marks the canvas dirty.
import { clamp, MIN_K, MAX_K, FIT_MIN_K, MINI_W, MINI_H, MINI_PAD } from './util.js';
/**
 * Attach the viewport API (pan/zoom transform, fit, zoom, focus/flash, search,
 * minimap) onto the shared context, as g.viewSize / g.applyTransform / g.fit /
 * g.zoomAround / g.zoomCenter / g.flash / g.focus / g.setCurrent / g.search /
 * g.buildMinimap / g.updateMinimap.
 */
export function attachView(g) {
    if (g.minK === undefined)
        g.minK = MIN_K; // live zoom floor; fit() lowers it to frame a huge graph
    g.viewSize = function () {
        const rect = g.svgEl.getBoundingClientRect();
        return { w: rect.width || g.container.clientWidth || 0, h: rect.height || g.container.clientHeight || 0, rect: rect };
    };
    g.applyTransform = function () {
        g.requestDraw();
        g.updateMinimap();
    };
    g.fit = function () {
        const vs = g.viewSize();
        const cw = g.layout.width, ch = g.layout.height;
        if (cw <= 0 || ch <= 0 || vs.w <= 0 || vs.h <= 0) {
            g.k = 1;
            g.tx = vs.w / 2;
            g.ty = vs.h / 2;
            g.applyTransform();
            return;
        }
        g.k = clamp(Math.min(vs.w / cw, vs.h / ch) * 0.9, FIT_MIN_K, MAX_K);
        g.minK = Math.min(MIN_K, g.k); // allow zooming back out to the fitted whole-graph overview
        g.tx = (vs.w - cw * g.k) / 2;
        g.ty = (vs.h - ch * g.k) / 2;
        g.applyTransform();
    };
    /**
     * Zoom by `factor`, keeping the world point under screen point (px,py) fixed.
     * @param px - screen-space anchor x
     * @param py - screen-space anchor y
     * @param factor - zoom multiplier (>1 in, <1 out)
     */
    g.zoomAround = function (px, py, factor) {
        const wx = (px - g.tx) / g.k, wy = (py - g.ty) / g.k;
        const nk = clamp(g.k * factor, g.minK, MAX_K);
        g.tx = px - wx * nk;
        g.ty = py - wy * nk;
        g.k = nk;
        g.applyTransform();
    };
    g.zoomCenter = function (factor) {
        const vs = g.viewSize();
        g.zoomAround(vs.w / 2, vs.h / 2, factor);
    };
    // Flash a node (search hit / current). Draw-state + expiry; the rAF loop fades it.
    g.flash = function (id) {
        const n = g.layout.nodes.get(id) || (g.extPos && g.extPos.get(id));
        if (!n)
            return;
        g.flashId = id;
        g.flashUntil = performance.now() + 1800;
        g.requestDraw();
    };
    /**
     * Centre the viewport on node `id` and flash it.
     * @returns whether the node exists in the layout and was focused
     */
    g.focus = function (id) {
        const n = g.layout.nodes.get(id);
        if (!n)
            return false;
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
        g.buildMinimap(); // recolour the current dot
        g.requestDraw();
    };
    /**
     * Focus the best-matching node by title/id: exact match first, then
     * prefix match, then substring match.
     * @returns the matched doc id, or null if none / query is blank
     */
    g.search = function (query) {
        const q = (query || '').trim().toLowerCase();
        if (!q)
            return null;
        let starts = null, includes = null;
        for (const id of g.sortedIds) {
            const meta = g.model.nodes.get(id);
            // A sorted id with no model entry would only be a bug upstream, but the id
            // is still matchable on its own - so miss the title, not the whole search.
            const title = ((meta && meta.title) || '').toLowerCase();
            const lid = id.toLowerCase();
            if (title === q || lid === q) {
                g.focus(id);
                return id;
            }
            if (starts === null && (title.indexOf(q) === 0 || lid.indexOf(q) === 0))
                starts = id;
            if (includes === null && (title.indexOf(q) !== -1 || lid.indexOf(q) !== -1))
                includes = id;
        }
        const hit = starts || includes;
        if (hit) {
            g.focus(hit);
            return hit;
        }
        return null;
    };
    // ---- Minimap (its own canvas; node dots cached, view-rect drawn each frame) ----
    g.buildMinimap = function () {
        if (!g.miniCanvas)
            return;
        try {
            const cw = g.layout.width || 1, ch = g.layout.height || 1;
            g.miniScale = Math.min((MINI_W - MINI_PAD * 2) / cw, (MINI_H - MINI_PAD * 2) / ch);
            if (!isFinite(g.miniScale) || g.miniScale <= 0)
                g.miniScale = 1;
            g.miniOX = (MINI_W - cw * g.miniScale) / 2;
            g.miniOY = (MINI_H - ch * g.miniScale) / 2;
            const dpr = window.devicePixelRatio || 1;
            const cache = g.miniCache || (g.miniCache = document.createElement('canvas'));
            cache.width = Math.round(MINI_W * dpr);
            cache.height = Math.round(MINI_H * dpr);
            // No 2D context (headless, or the browser's per-page context budget spent)
            // means no minimap this time round - decorative, so nothing else changes.
            const cx = cache.getContext('2d');
            if (!cx)
                return;
            cx.setTransform(dpr, 0, 0, dpr, 0, 0);
            cx.clearRect(0, 0, MINI_W, MINI_H);
            const muted = (g.colors && g.colors.muted) || '#888';
            const accent = (g.colors && g.colors.accent) || '#2563eb';
            for (const [id, n] of g.layout.nodes) {
                const meta = g.model.nodes.get(id);
                cx.fillStyle = (id === g.currentId) ? accent : muted;
                cx.globalAlpha = (meta && meta.missing) ? 0.4 : (id === g.currentId ? 1 : 0.5);
                cx.fillRect(g.miniOX + n.x * g.miniScale, g.miniOY + n.y * g.miniScale, Math.max(1, n.w * g.miniScale), Math.max(1, n.h * g.miniScale));
            }
            cx.globalAlpha = 1;
            g.updateMinimap();
        }
        catch (err) { /* minimap is decorative; never break the main view */ }
    };
    g.updateMinimap = function () {
        if (!g.miniCanvas || !g.miniCache)
            return;
        try {
            const dpr = window.devicePixelRatio || 1;
            if (g.miniCanvas.width !== Math.round(MINI_W * dpr)) {
                g.miniCanvas.width = Math.round(MINI_W * dpr);
                g.miniCanvas.height = Math.round(MINI_H * dpr);
            }
            // g.miniCtx is null when the minimap canvas refused a 2D context; the cache
            // above would be equally undrawable, so there is nothing to update.
            const ctx = g.miniCtx;
            if (!ctx)
                return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, MINI_W, MINI_H);
            ctx.drawImage(g.miniCache, 0, 0, MINI_W, MINI_H);
            const rect = g.svgEl.getBoundingClientRect();
            const w = rect.width, h = rect.height;
            if (w && h && g.k) {
                const vx = -g.tx / g.k, vy = -g.ty / g.k, vw = w / g.k, vh = h / g.k;
                const accent = (g.colors && g.colors.accent) || '#2563eb';
                const rx = g.miniOX + vx * g.miniScale, ry = g.miniOY + vy * g.miniScale, rw = vw * g.miniScale, rh = vh * g.miniScale;
                ctx.fillStyle = accent;
                ctx.globalAlpha = 0.12;
                ctx.fillRect(rx, ry, rw, rh);
                ctx.globalAlpha = 1;
                ctx.strokeStyle = accent;
                ctx.lineWidth = 1.25;
                ctx.strokeRect(rx, ry, rw, rh);
            }
        }
        catch (err) { /* ignore */ }
    };
}
