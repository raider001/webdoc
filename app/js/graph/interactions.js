// graph/interactions.ts - pointer / wheel / keyboard wiring for the CANVAS scene.
// Hit-testing goes through the spatial grid (g.nodeAtWorld / g.edgeAtWorld) instead
// of DOM .closest(), since nodes are no longer DOM elements. Pointer gesture
// bookkeeping stays local; only the live transform (g.tx/g.ty/g.k), draw-state and
// the view/edit callbacks are read off the shared context `g`. Sets g.destroy.
//
// NOTHING HERE TOUCHES CHROME. The zoom buttons, the search box and the minimap
// frame used to be wired from this file, which meant the engine could only run
// inside DOM it had built itself. They are the chrome's own listeners now (see
// graph/chrome-view.js); the one exception is the click on the minimap SURFACE,
// because turning a point on it into a pan is transform maths, not chrome.
import { DRAG_THRESHOLD, MINI_W, MINI_H } from './util.js';
/**
 * Convert client (screen) pixel coordinates to world coordinates under the
 * current pan/zoom transform.
 */
function toWorld(g, clientX, clientY) {
    const r = g.svgEl.getBoundingClientRect();
    return { wx: (clientX - r.left - g.tx) / g.k, wy: (clientY - r.top - g.ty) / g.k };
}
/**
 * Wire up pointer/wheel/keyboard interaction on the canvas, fit/restore the
 * initial view, and set g.destroy.
 */
export function wireInteractions(g) {
    const listeners = [];
    /**
     * addEventListener + remember the registration so g.destroy can remove
     * every listener later.
     * Generic over the event name so each handler gets its real event type -
     * 'pointerdown' hands back a PointerEvent with .clientX, 'wheel' a WheelEvent
     * with .deltaY. Typing fn as (e: Event) made every one of those a silent any.
     */
    function on(target, type, fn, opt) { target.addEventListener(type, fn, opt); listeners.push({ target: target, type: type, fn: fn, opt: opt }); }
    const svgEl = g.svgEl; // the <canvas> (kept the name so the CSS/pan code is unchanged)
    let dragging = false, moved = false, sx = 0, sy = 0, sTx = 0, sTy = 0;
    // What the pointer went DOWN on, so pointerup can tell a click from a pan and
    // a double click from two singles.
    let lastClickId = null;
    let lastClickTime = 0;
    let downNodeId = null;
    let downExtUrl = null;
    let downEdge = null;
    on(svgEl, 'pointerdown', function (e) {
        if (e.button !== 0)
            return;
        const w = toWorld(g, e.clientX, e.clientY);
        const hitId = g.nodeAtWorld(w.wx, w.wy);
        downNodeId = null;
        downExtUrl = null;
        downEdge = null;
        if (hitId) {
            const meta = g.model.nodes.get(hitId);
            if (!meta && g.extPos && g.extPos.has(hitId)) {
                const en = g.externalNodes.find(x => x.id === hitId);
                downExtUrl = en ? en.url : null;
            }
            else if (meta && !meta.missing)
                downNodeId = hitId;
        }
        else if (g.editMode) {
            downEdge = g.edgeAtWorld(w.wx, w.wy, 9 / g.k);
        }
        dragging = true;
        moved = false;
        sx = e.clientX;
        sy = e.clientY;
        sTx = g.tx;
        sTy = g.ty;
        svgEl.classList.add('is-panning');
        try {
            svgEl.setPointerCapture(e.pointerId);
        }
        catch (err) { }
    });
    on(svgEl, 'pointermove', function (e) {
        if (dragging) {
            const dx = e.clientX - sx, dy = e.clientY - sy;
            if (!moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD))
                moved = true;
            if (moved) {
                g.tx = sTx + dx;
                g.ty = sTy + dy;
                g.applyTransform();
            }
            return;
        }
        // hover highlight (canvas has no :hover) - only repaint when the node changes
        const w = toWorld(g, e.clientX, e.clientY);
        const hid = g.nodeAtWorld(w.wx, w.wy);
        if (hid !== g.hoverId) {
            g.hoverId = hid;
            g.requestDraw();
        }
    });
    on(svgEl, 'pointerup', function (e) {
        if (!dragging)
            return;
        dragging = false;
        svgEl.classList.remove('is-panning');
        try {
            svgEl.releasePointerCapture(e.pointerId);
        }
        catch (err) { }
        if (!moved && g.editMode) {
            // Edit mode: click node A then node B to connect; click a line to select it.
            if (downNodeId) {
                if (!g.pendingSource) {
                    g.markSource(downNodeId);
                    g.clearSelectedEdge();
                }
                else if (g.pendingSource === downNodeId) {
                    g.clearPending();
                }
                else {
                    const s = g.pendingSource, t = downNodeId;
                    g.clearPending();
                    if (g.onConnect)
                        g.onConnect(s, t, g.activeConnector);
                }
            }
            else if (downEdge) {
                g.selectEdge(downEdge.from, downEdge.to, downEdge.type);
            }
            else {
                g.clearPending();
                g.clearSelectedEdge();
            }
            downNodeId = null;
            downExtUrl = null;
            downEdge = null;
            return;
        }
        if (!moved && downExtUrl) {
            window.open(downExtUrl, '_blank', 'noopener'); // external link box -> new tab
        }
        else if (!moved && downNodeId) {
            const id = downNodeId;
            const now = Date.now();
            if (lastClickId === id && (now - lastClickTime) < 350) {
                lastClickId = null;
                g.onActivate(id); // double click -> open the doc and leave the map
            }
            else {
                lastClickId = id;
                lastClickTime = now;
                g.setCurrent(id);
                g.onSelect(id); // single click -> select it, stay on the map
            }
        }
        downNodeId = null;
        downExtUrl = null;
        downEdge = null;
    });
    on(svgEl, 'pointercancel', function () { dragging = false; svgEl.classList.remove('is-panning'); });
    on(svgEl, 'wheel', function (e) {
        e.preventDefault();
        const rect = svgEl.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.0015);
        g.zoomAround(px, py, factor);
    }, { passive: false });
    // Edit-mode keys: Delete removes the selected connection; Escape cancels a
    // pending connect / selection (capture phase, so it pre-empts the overlay close).
    on(document, 'keydown', function (e) {
        if (!g.editMode)
            return;
        const tgt = e.target;
        const tag = (tgt && tgt.tagName) || '';
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (tgt && tgt.isContentEditable))
            return;
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (g.selectedEdge && g.onDisconnect) {
                e.preventDefault();
                e.stopPropagation(); // consume it here - edit mode's Delete is for links, never the document handler below
                const se = g.selectedEdge;
                g.clearSelectedEdge();
                g.onDisconnect(se.from, se.to, se.type);
            }
        }
        else if (e.key === 'Escape' && (g.pendingSource || g.selectedEdge)) {
            e.preventDefault();
            e.stopPropagation();
            g.clearPending();
            g.clearSelectedEdge();
        }
    }, true);
    // Delete key: delete the currently-selected DOCUMENT (doc map only; the app
    // wires g.onDelete to confirm + remove the file).
    on(document, 'keydown', function (e) {
        if (e.key !== 'Delete')
            return;
        if (!g.onDelete)
            return;
        if (g.editMode)
            return; // edit-connections mode: Delete only ever removes a selected link, never a document
        const tgt = e.target;
        const tag = (tgt && tgt.tagName) || '';
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (tgt && tgt.isContentEditable))
            return;
        const id = g.currentId;
        if (!id || !g.layout.nodes.has(id))
            return; // need a real, laid-out node selected
        e.preventDefault();
        g.onDelete(id);
    });
    // Click the minimap to recentre. The surface is the caller's element, so it is
    // optional - view.js draws a minimap only when there is one to draw on.
    if (g.miniCanvas)
        on(g.miniCanvas, 'click', function (e) {
            try {
                const rect = g.miniCanvas.getBoundingClientRect();
                const mx = (e.clientX - rect.left) * (MINI_W / rect.width);
                const my = (e.clientY - rect.top) * (MINI_H / rect.height);
                const wx = (mx - g.miniOX) / g.miniScale, wy = (my - g.miniOY) / g.miniScale;
                const vs = g.viewSize();
                g.tx = vs.w / 2 - wx * g.k;
                g.ty = vs.h / 2 - wy * g.k;
                g.applyTransform();
            }
            catch (err) { }
        });
    // Fit once the container actually has a size (handles being opened in a hidden
    // overlay that becomes visible after createGraph runs).
    g.buildMinimap();
    const vs0 = g.viewSize();
    const it = g.opts.initialTransform;
    if (it && isFinite(it.k) && isFinite(it.tx) && isFinite(it.ty)) {
        g.tx = it.tx;
        g.ty = it.ty;
        g.k = it.k;
        g.applyTransform();
        g.fitted = true; // restore prior view
    }
    else if (vs0.w > 0 && vs0.h > 0) {
        g.fit();
        g.fitted = true;
    }
    else {
        g.applyTransform();
    }
    if (typeof ResizeObserver !== 'undefined') {
        g.ro = new ResizeObserver(function () {
            if (g.resize)
                g.resize(); // resize the canvas backing store
            const vs = g.viewSize();
            if (!g.fitted && vs.w > 0 && vs.h > 0) {
                g.fit();
                g.fitted = true;
            }
            else
                g.updateMinimap();
        });
        g.ro.observe(g.container);
    }
    // Focus/centre the current doc if there is one (after fit so it wins).
    if (g.currentId && g.layout.nodes.has(g.currentId))
        g.flash(g.currentId);
    g.destroy = function () {
        for (const l of listeners) {
            try {
                l.target.removeEventListener(l.type, l.fn, l.opt);
            }
            catch (err) { }
        }
        listeners.length = 0;
        if (g.ro) {
            try {
                g.ro.disconnect();
            }
            catch (err) { }
            g.ro = null;
        }
        if (g.themeObs) {
            try {
                g.themeObs.disconnect();
            }
            catch (err) { }
            g.themeObs = null;
        }
        if (g.drawStop)
            g.drawStop();
        if (g.flashTimer) {
            clearTimeout(g.flashTimer);
            g.flashTimer = null;
        }
        // Remove EXACTLY the one element this engine created. `container.textContent
        // = ''` used to stand here, which deleted every sibling too - fine while the
        // engine had built all of them, fatal the moment anything else owns DOM in
        // the same host.
        if (g.canvas && g.canvas.parentNode)
            g.canvas.parentNode.removeChild(g.canvas);
    };
}
