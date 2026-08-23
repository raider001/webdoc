// graph/chrome-view.ts - the vanilla overlay chrome for a graph that has no
// components of its own: zoom controls, a search box, a minimap frame and the
// empty state. A CONSUMER of the public controller rather than a stage of it.
// ---------------------------------------------------------------------------
// It used to build ALL of the map's chrome - edge legend, "Map by" dropdown,
// access-group legend, edit-connections toggle + hint, focus toggle - and before
// that, those controls were built by the engine itself against its internal
// context `g` (that file is graph/edit-state.js now, and is state only).
//
// Moving them out here was the whole point. The engine owns exactly one element
// - its <canvas> - so it can be mounted inside DOM somebody else manages (an
// island, a component, a harness) without clearing it, and this file can be
// replaced by components without the engine noticing.
//
// AND IT HAS BEEN, FOR THE DOCUMENT MAP. MapOverlay.svelte and its siblings
// (MapToolbar, MapSearch, EdgeLegend, MapModeSelect, GroupLegend, EditControls,
// MapEmpty) render every one of those controls now, and the map builds its engine
// through createGraphController - the bare controller - so it never reaches this
// file at all.
//
// WHAT IS LEFT, AND FOR WHOM. One caller: the COVERAGE view, through createGraph
// (app/svelte/CoverageOverlay.svelte -> actions/graph.ts's `graph` action). It
// wants a zoom cluster, a search box and a minimap and has no components for
// them. It passes none of onConnect / onDisconnect / onFocusToggle /
// accessGroups / mapModes, and used to pass hideLegend to switch off the rest -
// so every control this file gated on those was building nothing for the only
// consumer it had. Those branches are gone; the components above are where that
// markup lives now.
//
// WHICH IS ALSO WHY THERE IS NO on('change') SUBSCRIPTION. Everything still here
// is WRITE-ONLY: zoom in, zoom out, fit and search are commands to the
// controller, and not one of them reflects state back. The controls that PAINTED
// state are exactly the ones that became components, so their departure took the
// whole render pass with them.
//
// TWO-PHASE ON PURPOSE. The minimap <canvas> has to exist BEFORE the controller
// is built (the engine paints the minimap during its initial fit), but the chrome
// must be appended AFTER the engine's canvas so the paint order matches what the
// map has always had. So building fills a DocumentFragment and hands the minimap
// canvas back; connect(ctl) appends it and wires the handlers.
import { elem } from '../dom.js';
import { plusIcon, minusIcon, fitIcon } from '../icons.js';
/**
 * Build the overlay chrome for a graph inside `container`.
 *
 * It takes no options any more. What is left is the same for every caller, and
 * the controls that were worth configuring are components now.
 *
 * `container` is the same element the controller renders its canvas into: the
 * chrome sits on top by z-index (see app/css/graph.css), not by DOM order, and
 * NOTHING here ever clears the container - that habit is exactly what made the
 * engine and a component renderer fight over the same children.
 */
export function mountGraphChrome(container) {
    // Applied at BUILD time, not at connect: .graph-root is what gives the stage a
    // height, and the engine measures that height while it fits itself. Adding the
    // class afterwards would leave the first fit looking at a zero-height box and
    // push the whole framing onto whichever ResizeObserver frame arrived next.
    container.classList.add('graph-root');
    const frag = document.createDocumentFragment();
    const owned = []; // everything this module put in the container, for destroy()
    /**
     * The live controller, or null until connect() runs. Every handler below reads
     * it late rather than closing over it, because the DOM is built first.
     */
    let ctl = null;
    const own = (node) => { frag.appendChild(node); owned.push(node); return node; };
    /**
     * @param icon - an inline SVG built by icons.js
     * @param aria - doubles as the tooltip, so the label is never mouse-only
     */
    const ctrlBtn = (icon, aria) => elem('button', { type: 'button', class: 'graph-ctrl-btn', 'aria-label': aria, title: aria }, icon);
    // ---- Zoom controls ----
    // The `!`s: every icons.js factory is a one-root template read back through
    // .firstElementChild, so the element is always there - the null the DOM type
    // allows for is an empty template, which none of these are.
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
    // ---- Minimap (small, best-effort; never allowed to break the main view) ----
    const minimapCanvas = elem('canvas', 'graph-minimap-svg'); // reuse the 100% x 100% sizing rule
    own(elem('div', 'graph-minimap', minimapCanvas));
    return {
        minimapCanvas: minimapCanvas,
        /**
         * Attach the chrome to a live controller: append it, and settle the one piece
         * of it that could not be decided until there was a controller to ask.
         */
        connect: function (controller) {
            ctl = controller;
            // The empty state is decided here rather than at build time because only
            // the controller knows how many nodes the model actually produced. own()
            // before the append, or it would land in a fragment already spent.
            if (controller.getNodePositions().size === 0)
                own(elem('div', 'graph-empty', 'No documents to map.'));
            container.appendChild(frag);
        },
        destroy: function () {
            for (const node of owned) {
                if (node.parentNode)
                    node.parentNode.removeChild(node);
            }
            owned.length = 0;
            container.classList.remove('graph-root');
            ctl = null;
        }
    };
}
