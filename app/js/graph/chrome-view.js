// graph/chrome-view.js - the map's overlay chrome, as a CONSUMER of the graph
// controller rather than a stage of it.
// ---------------------------------------------------------------------------
// Zoom controls, search box, edge legend, "Map by" dropdown, access-group legend,
// edit-connections toggle + hint, focus toggle, the minimap frame and the empty
// state. Every one of them used to be built by graph/chrome.js against the
// engine's internal context `g`; here they are built against the PUBLIC
// controller and a plain options bag, and they learn about state only through
// ctl.on('change').
//
// That inversion is the whole point of the module. The engine now owns exactly
// one element - its <canvas> - so it can be mounted inside DOM somebody else
// manages (an island, a component, a harness) without clearing it, and this file
// can be replaced by components without the engine noticing.
//
// TWO-PHASE ON PURPOSE. The minimap <canvas> has to exist BEFORE the controller
// is built (the engine paints the minimap during its initial fit), but the chrome
// must be appended AFTER the engine's canvas so the paint order matches what the
// map has always had. So building fills a DocumentFragment and hands the minimap
// canvas back; connect(ctl) appends it and wires the handlers.
import { elem, append } from '../dom.js';
import { plusIcon, minusIcon, fitIcon, editIcon, focusIcon, chevronDownIcon } from '../icons.js';
import { groupLabel, groupColor } from '../auth.js';
/** @typedef {import('../graph.js').GraphOptions} GraphOptions */
/** @typedef {import('../graph.js').GraphController} GraphController */
/** @typedef {import('../graph.js').GraphChangeEvent} GraphChangeEvent */
/**
 * The handle mountGraphChrome() returns: the minimap surface the controller has
 * to be told about, the connect step that attaches the chrome to a live
 * controller, and the teardown that removes every element this module made.
 * @typedef {Object} GraphChromeHandle
 * @property {HTMLCanvasElement} minimapCanvas - pass to the controller as opts.minimapCanvas
 * @property {(ctl: GraphController) => void} connect
 * @property {() => void} destroy
 */
/**
 * Build the overlay chrome for a graph inside `container`.
 *
 * `container` is the same element the controller renders its canvas into: the
 * chrome sits on top by z-index (see app/css/graph.css), not by DOM order, and
 * NOTHING here ever clears the container - that habit is exactly what made the
 * engine and a component renderer fight over the same children.
 * @param {HTMLElement} container
 * @param {GraphOptions} [options]
 * @returns {GraphChromeHandle}
 */
export function mountGraphChrome(container, options) {
    const opts = options || {};
    // Applied at BUILD time, not at connect: .graph-root is what gives the stage a
    // height, and the engine measures that height while it fits itself. Adding the
    // class afterwards would leave the first fit looking at a zero-height box and
    // push the whole framing onto whichever ResizeObserver frame arrived next.
    container.classList.add('graph-root');
    const frag = document.createDocumentFragment();
    /** @type {Element[]} */
    const owned = []; // everything this module put in the container, for destroy()
    /** @type {(() => void)[]} */
    const cleanups = []; // document-level listeners the dropdown may have left open
    /**
     * The live controller, or null until connect() runs. Every handler below reads
     * it late rather than closing over it, because the DOM is built first.
     * @type {GraphController|null}
     */
    let ctl = null;
    /** @type {(() => void)|null} */
    let unsubscribe = null;
    /**
     * @template {Element} T
     * @param {T} node
     * @returns {T}
     */
    const own = (node) => { frag.appendChild(node); owned.push(node); return node; };
    /**
     * @param {Element} icon - an inline SVG built by icons.js
     * @param {string} aria - doubles as the tooltip, so the label is never mouse-only
     * @returns {HTMLButtonElement}
     */
    const ctrlBtn = (icon, aria) => elem('button', { type: 'button', class: 'graph-ctrl-btn', 'aria-label': aria, title: aria }, icon);
    // ---- Zoom controls ----
    const btnIn = ctrlBtn(plusIcon(), 'Zoom in');
    const btnOut = ctrlBtn(minusIcon(), 'Zoom out');
    const btnFit = ctrlBtn(fitIcon(), 'Fit to view');
    btnIn.addEventListener('click', () => { if (ctl)
        ctl.zoomBy(1.25); });
    btnOut.addEventListener('click', () => { if (ctl)
        ctl.zoomBy(1 / 1.25); });
    btnFit.addEventListener('click', () => { if (ctl)
        ctl.fit(); });
    own(elem('div', 'graph-controls', btnIn, btnOut, btnFit));
    // ---- Search ----
    const searchInput = elem('input', { type: 'search', placeholder: 'Find a document…', 'aria-label': 'Find a document in the map', autocomplete: 'off' });
    searchInput.addEventListener('input', () => { if (ctl)
        ctl.search(searchInput.value); });
    searchInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter')
            return;
        e.preventDefault();
        if (ctl)
            ctl.search(searchInput.value);
    });
    own(elem('div', 'graph-search', searchInput));
    // ---- Legend (each entry toggles a category; in edit mode prereq/recnext act
    //      as connector pickers instead) ----
    /** @type {Object<string, HTMLButtonElement>} */
    const legendBtns = {};
    /**
     * One legend entry: toggles category `kind`'s visibility, unless edit mode is
     * on and it's prereq/recnext, in which case it picks the active connector.
     *
     * Neither branch writes the button's own look - both ask the controller, and
     * the change event that comes back is what repaints this button. Going the
     * long way round is what keeps the legend honest when the engine overrules it
     * (edit mode forcing page links off, say).
     * @param {string} kind - edge category ('prereq'|'recnext'|'trace'|'pagelink'|'missing')
     * @param {string} label
     * @returns {HTMLElement}
     */
    function legendToggle(kind, label) {
        const b = elem('button', { type: 'button', class: 'graph-legend-item', 'data-kind': kind, 'aria-pressed': 'true', title: 'Toggle ' + label }, elem('span', 'graph-legend-swatch ' + kind), label);
        b.addEventListener('click', function () {
            if (!ctl)
                return;
            const s = ctl.getEditState();
            if (s.editMode && (kind === 'prereq' || kind === 'recnext')) {
                ctl.setConnector(kind);
                return;
            }
            ctl.setVisibility(kind, s.visibility[kind] === false);
        });
        legendBtns[kind] = b;
        return b;
    }
    if (!opts.hideLegend) {
        const legend = elem('div', 'graph-legend');
        // "Map by" dropdown: choose which connection type drives the tree layout. A
        // custom dropdown (not native <select>) so each option can carry its swatch.
        const modes = Array.isArray(opts.mapModes) ? opts.mapModes : null;
        if (modes && modes.length > 1) {
            const dd = buildMapModeDropdown(modes, opts.mapMode || modes[0].value, (m) => { if (ctl)
                ctl.setMapMode(m); });
            cleanups.push(dd.close);
            append(legend, dd.el);
        }
        append(legend, legendToggle('prereq', 'Prerequisite'), legendToggle('recnext', 'Recommended next'), (opts.traceEdges && opts.traceEdges.length) ? legendToggle('trace', 'Requirement trace') : null, (opts.pageLinks && opts.pageLinks.length) ? legendToggle('pagelink', 'Page link') : null, legendToggle('missing', 'Missing'));
        own(legend);
    }
    // ---- Access-group legend (doc map, only when something is restricted) ----
    // The map is the one place a reader can see the SHAPE of what is locked down:
    // which chapters share a group, where a restriction starts, and which pages
    // they cannot open. Each entry dims every node readable only by that group, so
    // "show me just what Ops can see" is one click.
    /** @type {Object<string, HTMLButtonElement>} */
    const groupBtns = {};
    const accessGroups = Array.isArray(opts.accessGroups) ? opts.accessGroups : [];
    if (accessGroups.length && !opts.hideLegend) {
        const panel = elem('div', 'graph-groups');
        append(panel, elem('p', 'graph-groups-title', 'Access groups'));
        for (const name of accessGroups) {
            const dot = elem('span', 'group-dot');
            dot.style.background = groupColor(name);
            const btn = elem('button', {
                type: 'button', class: 'graph-group-item',
                'aria-pressed': 'true',
                title: 'Dim the pages only this group can read'
            }, dot, groupLabel(name));
            btn.addEventListener('click', () => {
                if (!ctl)
                    return;
                const next = new Set(ctl.getEditState().hiddenGroups);
                if (next.has(name))
                    next.delete(name);
                else
                    next.add(name);
                ctl.setHiddenGroups(next);
            });
            groupBtns[name] = btn;
            append(panel, btn);
        }
        append(panel, elem('p', 'graph-groups-note', 'A locked page shows a padlock: it exists, but your account cannot open it.'));
        own(panel);
    }
    // ---- Edit-connections toggle + hint (only when the caller can act on edits) ----
    /** @type {HTMLButtonElement|null} */
    let editBtn = null;
    /** @type {HTMLElement|null} */
    let hintEl = null;
    if ((opts.onConnect || opts.onDisconnect) && !opts.hideLegend) {
        editBtn = elem('button', { type: 'button', class: 'graph-edit-toggle', 'aria-pressed': 'false', title: 'Draw or delete connections between documents' }, editIcon(), ' Edit connections');
        editBtn.addEventListener('click', () => { if (ctl)
            ctl.setEditMode(!ctl.getEditState().editMode); });
        hintEl = elem('div', { class: 'graph-edit-hint', hidden: true });
        own(editBtn);
        own(hintEl);
    }
    // ---- Focus-mode toggle (doc map only; the app owns what focus mode means) ----
    if (opts.onFocusToggle) {
        const focusBtn = elem('button', { type: 'button', class: 'graph-focus-toggle' + (opts.focusMode ? ' is-on' : ''), 'aria-pressed': opts.focusMode ? 'true' : 'false', title: 'Focus mode: click a node to centre the map on it and its links (Esc resets)' }, focusIcon(), ' Focus');
        // Straight to the app, not through the controller: entering or leaving focus
        // mode re-lays-out the whole graph, which the app does by building a NEW
        // controller. There is nothing for this instance to be told.
        focusBtn.addEventListener('click', () => { if (opts.onFocusToggle)
            opts.onFocusToggle(); });
        own(focusBtn);
    }
    // ---- Minimap (small, best-effort; never allowed to break the main view) ----
    const minimapCanvas = elem('canvas', 'graph-minimap-svg'); // reuse the 100% x 100% sizing rule
    own(elem('div', 'graph-minimap', minimapCanvas));
    /**
     * Repaint every control from one change event. This is the ONLY place chrome
     * state is written, which is what makes "the engine never touches a button"
     * enforceable rather than aspirational.
     * @param {GraphChangeEvent} s
     * @returns {void}
     */
    function render(s) {
        container.classList.toggle('is-editing', s.editMode);
        if (editBtn) {
            editBtn.classList.toggle('is-on', s.editMode);
            editBtn.setAttribute('aria-pressed', s.editMode ? 'true' : 'false');
        }
        if (hintEl) {
            hintEl.hidden = !s.editMode;
            hintEl.textContent = hintFor(s);
        }
        for (const kind of Object.keys(legendBtns)) {
            const b = legendBtns[kind];
            const off = s.visibility[kind] === false;
            b.setAttribute('aria-pressed', off ? 'false' : 'true');
            b.classList.toggle('is-off', off);
            const connectable = kind === 'prereq' || kind === 'recnext';
            b.classList.toggle('is-connector', s.editMode && connectable);
            b.classList.toggle('is-connector-active', s.editMode && connectable && kind === s.connector);
        }
        for (const name of Object.keys(groupBtns)) {
            const hidden = s.hiddenGroups.has(name);
            groupBtns[name].classList.toggle('is-off', hidden);
            groupBtns[name].setAttribute('aria-pressed', hidden ? 'false' : 'true');
        }
    }
    return {
        minimapCanvas: minimapCanvas,
        /**
         * Attach the chrome to a live controller: append it, subscribe, and paint the
         * current state once, so the first frame is right without waiting for a
         * change nobody has made yet.
         * @param {GraphController} controller
         * @returns {void}
         */
        connect: function (controller) {
            ctl = controller;
            // The empty state is decided here rather than at build time because only
            // the controller knows how many nodes the model actually produced.
            if (controller.getNodePositions().size === 0)
                own(elem('div', 'graph-empty', 'No documents to map.'));
            container.appendChild(frag);
            unsubscribe = controller.on('change', render);
            render(controller.getEditState());
        },
        destroy: function () {
            if (unsubscribe) {
                unsubscribe();
                unsubscribe = null;
            }
            for (const fn of cleanups) {
                try {
                    fn();
                }
                catch (err) { /* teardown is best-effort */ }
            }
            cleanups.length = 0;
            for (const node of owned) {
                if (node.parentNode)
                    node.parentNode.removeChild(node);
            }
            owned.length = 0;
            container.classList.remove('graph-root', 'is-editing');
            ctl = null;
        }
    };
}
/**
 * The hint under the edit toggle. It is the only instruction a reader gets for a
 * two-click gesture on a canvas, so it is DERIVED from the emitted state rather
 * than written at each transition - there is no path through the state machine
 * that can leave it stale.
 * @param {GraphChangeEvent} s
 * @returns {string}
 */
function hintFor(s) {
    if (!s.editMode)
        return '';
    if (s.selectedEdge)
        return 'Connection selected — press Delete to remove it.';
    if (s.pendingSourceTitle) {
        return s.connector === 'prereq'
            ? 'Now click the document “' + s.pendingSourceTitle + '” should assume (its prerequisite).'
            : 'Now click the document to read next after “' + s.pendingSourceTitle + '”.';
    }
    return s.connector === 'prereq'
        ? 'Prerequisite: click a document, then the one it assumes. (Or click a line + Delete.)'
        : 'Recommended next: click a document, then the one to read next. (Or click a line + Delete.)';
}
// Custom "Map by" dropdown: a button showing the current type's swatch + label, and
// a popup list where each option carries its own coloured swatch (a native <select>
// can't). Picking a different type asks the app to relayout, which replaces this
// whole chrome - so nothing here has to re-render itself.
/**
 * @param {{value: string, label: string, swatch: string}[]} modes
 * @param {string} current
 * @param {(mode: string) => void} onPick
 * @returns {{el: HTMLElement, close: () => void}}
 */
function buildMapModeDropdown(modes, current, onPick) {
    /** @param {string} cls - edge category of the map mode; blank/absent means the 'all' modes swatch */
    const swatch = (cls) => elem('span', 'graph-legend-swatch ' + (cls || 'all'));
    const cur = modes.find(m => m.value === current) || modes[0];
    // Stack every label in one cell (only the current shown) so the button is always
    // as wide as the widest option - the legend never resizes on selection.
    const btnLabel = elem('span', 'graph-mapmode-label', modes.map(m => elem('span', { class: m.value === current ? 'is-cur' : null }, m.label)));
    const btn = elem('button', { type: 'button', class: 'graph-mapmode-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, 'Map: ', swatch(cur.swatch), btnLabel, elem('span', 'graph-mapmode-caret', chevronDownIcon()));
    const menu = elem('div', { class: 'graph-mapmode-menu', role: 'listbox', hidden: true }, modes.map(m => elem('button', {
        type: 'button', class: 'graph-mapmode-item' + (m.value === current ? ' is-sel' : ''), role: 'option',
        onClick: () => { close(); if (m.value !== current)
            onPick(m.value); }
    }, swatch(m.swatch), elem('span', null, m.label))));
    /** @type {((e: MouseEvent) => void)|null} */
    let offClick = null;
    function open() {
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        offClick = (e) => { if (!wrap.contains(/** @type {Node} */ (e.target)))
            close(); };
        setTimeout(() => document.addEventListener('mousedown', offClick), 0);
    }
    function close() {
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        if (offClick) {
            document.removeEventListener('mousedown', offClick);
            offClick = null;
        }
    }
    btn.addEventListener('click', () => (menu.hidden ? open() : close()));
    const wrap = elem('div', 'graph-mapmode', btn, menu);
    return { el: wrap, close: close };
}
