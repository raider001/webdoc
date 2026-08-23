// panzoom.js - a small, hand-written, zero-dependency pan/zoom viewport (core).
// ---------------------------------------------------------------------------
// Wraps any rendered content (typically a diagram <svg>) in a fixed-height frame
// the reader can PAN (drag), ZOOM (buttons; or the wheel once the frame is
// focused) and RESIZE (drag the frame's bottom edge). It is purely
// transform-based - the same approach the map view uses - so it costs nothing
// until interacted with and ships no third-party code. Any renderer plugin can
// wrap its output in this.
//
// Wheel-zoom is deliberately gated on focus so that scrolling the page past a
// diagram is not trapped: click or tab into the frame first, then the wheel
// zooms; the +/- buttons always work.
// ---------------------------------------------------------------------------
import { plusIcon, minusIcon, fitIcon } from './icons.js';
/**
 * Tuning knobs for the pan/zoom viewport, all optional.
 * @typedef {Object} PanZoomOptions
 * @property {number} [height] - viewport frame height in px (default 440)
 * @property {number} [minScale] - minimum zoom scale (default 0.05)
 * @property {number} [maxScale] - maximum zoom scale (default 8)
 * @property {number} [padding] - fraction of the frame `fit()` scales content to fill (default 0.94)
 */
/**
 * Wrap `content` (typically a rendered SVG, or a div wrapping one) in a
 * pan/zoom viewport: drag to pan, the +/- buttons (or the wheel once the
 * frame is focused) to zoom, arrow keys to pan and 0 to fit, plus a one-time
 * auto-fit once the frame is first measured after mounting.
 * @param {HTMLElement|SVGElement} content - moved into the viewport's stage, not cloned
 * @param {PanZoomOptions} [opts]
 * @returns {HTMLElement} the viewport element, already containing `content` and its zoom controls
 */
export function createPanZoom(content, opts = {}) {
    const height = opts.height || 440;
    const minK = opts.minScale || 0.05;
    const maxK = opts.maxScale || 8;
    const padding = opts.padding || 0.94; // leave a little breathing room when fitting
    const viewport = document.createElement('div');
    viewport.className = 'pz-viewport';
    viewport.style.height = height + 'px';
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'group');
    viewport.setAttribute('aria-label', 'Pan and zoom diagram. Drag to pan; use the buttons, or the scroll wheel once focused, to zoom.');
    const stage = document.createElement('div');
    stage.className = 'pz-stage';
    stage.appendChild(content);
    viewport.appendChild(stage);
    let x = 0, y = 0, k = 1;
    /** @param {number} v - a candidate scale, clamped into the configured zoom range */
    const clamp = (v) => Math.max(minK, Math.min(maxK, v));
    const apply = () => { stage.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + k + ')'; };
    const midX = () => viewport.clientWidth / 2;
    const midY = () => viewport.clientHeight / 2;
    /**
     * The unscaled (k=1) pixel size of the wrapped content, used by `fit()` to
     * compute the fit-to-view scale.
     * @typedef {Object} NaturalSize
     * @property {number} w
     * @property {number} h
     */
    /**
     * An SVG's own viewBox size (exact, independent of the current scale) if it
     * has one, otherwise its live bounding rect divided back out by the current
     * scale `k`.
     * @returns {NaturalSize}
     */
    function naturalSize() {
        const svg = (content.tagName && content.tagName.toLowerCase() === 'svg')
            ? /** @type {SVGSVGElement} */ (content) : content.querySelector('svg');
        const vb = svg && svg.viewBox && svg.viewBox.baseVal;
        if (vb && vb.width)
            return { w: vb.width, h: vb.height };
        const r = (svg || content).getBoundingClientRect();
        return { w: r.width / (k || 1), h: r.height / (k || 1) };
    }
    /**
     * Zoom by `factor`, keeping the point (ax, ay) in viewport coords anchored.
     * @param {number} factor
     * @param {number} ax
     * @param {number} ay
     * @returns {void}
     */
    function zoomAt(factor, ax, ay) {
        const nk = clamp(k * factor);
        const r = nk / k;
        x = ax - r * (ax - x);
        y = ay - r * (ay - y);
        k = nk;
        apply();
    }
    function fit() {
        const vw = viewport.clientWidth, vh = viewport.clientHeight;
        const cs = naturalSize();
        if (!vw || !vh || !cs.w || !cs.h)
            return;
        k = clamp(Math.min(vw / cs.w, vh / cs.h) * padding);
        x = (vw - cs.w * k) / 2;
        y = (vh - cs.h * k) / 2;
        apply();
    }
    const controls = document.createElement('div');
    controls.className = 'pz-controls';
    /**
     * A small toolbar button that stops propagation so it never starts a pan.
     * @param {Element} icon - an icons.js node, e.g. plusIcon()
     * @param {string} title - tooltip / aria-label text
     * @param {() => void} fn - invoked on click
     * @returns {HTMLButtonElement}
     */
    const button = (icon, title, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pz-btn';
        b.appendChild(icon);
        b.title = title;
        b.setAttribute('aria-label', title);
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        b.addEventListener('pointerdown', (e) => e.stopPropagation()); // don't start a pan
        return b;
    };
    controls.append(button(plusIcon(), 'Zoom in', () => zoomAt(1.2, midX(), midY())), button(minusIcon(), 'Zoom out', () => zoomAt(1 / 1.2, midX(), midY())), button(fitIcon(), 'Fit to view', fit));
    viewport.appendChild(controls);
    // --- panning (pointer drag) ---
    let dragging = false, px = 0, py = 0;
    viewport.addEventListener('pointerdown', (e) => {
        if ( /** @type {Element} */(e.target).closest('.pz-controls'))
            return;
        dragging = true;
        px = e.clientX;
        py = e.clientY;
        viewport.classList.add('is-panning');
        try {
            viewport.setPointerCapture(e.pointerId);
        }
        catch (_) { }
    });
    viewport.addEventListener('pointermove', (e) => {
        if (!dragging)
            return;
        x += e.clientX - px;
        y += e.clientY - py;
        px = e.clientX;
        py = e.clientY;
        apply();
    });
    /**
     * @param {PointerEvent} e
     * @returns {void}
     */
    const endPan = (e) => {
        if (!dragging)
            return;
        dragging = false;
        viewport.classList.remove('is-panning');
        try {
            viewport.releasePointerCapture(e.pointerId);
        }
        catch (_) { }
    };
    viewport.addEventListener('pointerup', endPan);
    viewport.addEventListener('pointercancel', endPan);
    // --- wheel zoom (only when focused, so page scroll is not trapped) ---
    viewport.addEventListener('wheel', (e) => {
        if (document.activeElement !== viewport)
            return; // let the page scroll normally
        e.preventDefault();
        const rect = viewport.getBoundingClientRect();
        zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
    // --- keyboard (arrows pan, +/- zoom, 0 fits) ---
    viewport.addEventListener('keydown', (e) => {
        const step = 40;
        switch (e.key) {
            case 'ArrowLeft':
                x += step;
                break;
            case 'ArrowRight':
                x -= step;
                break;
            case 'ArrowUp':
                y += step;
                break;
            case 'ArrowDown':
                y -= step;
                break;
            case '+':
            case '=':
                zoomAt(1.2, midX(), midY());
                e.preventDefault();
                return;
            case '-':
            case '_':
                zoomAt(1 / 1.2, midX(), midY());
                e.preventDefault();
                return;
            case '0':
                fit();
                e.preventDefault();
                return;
            default: return;
        }
        apply();
        e.preventDefault();
    });
    // Fit once the frame has a measured size (it is mounted after this returns);
    // then stop observing so a user resize keeps their current pan/zoom.
    const ro = new ResizeObserver(() => {
        if (viewport.clientWidth > 0 && viewport.clientHeight > 0) {
            fit();
            ro.disconnect();
        }
    });
    ro.observe(viewport);
    return viewport;
}
