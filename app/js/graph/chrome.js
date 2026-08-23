// graph/chrome.js - the EDIT-MODE STATE MACHINE, and only that.
// ---------------------------------------------------------------------------
// This file used to build the overlay chrome (zoom controls, search box, legend,
// edit toggle + hint, minimap, empty state) AND run the edit-mode state machine
// against the buttons it had just built. That coupling is what made the engine
// un-mountable inside anything that owns its own DOM: setConnector reached for a
// legend button, setEditMode wrote aria-pressed, updateHint wrote text into an
// element only this file knew about.
//
// The DOM half now lives in ./chrome-view.js, which is a CONSUMER of the public
// controller (graph.js) rather than a stage of it. What is left here is the part
// that genuinely belongs to the engine: which connector is armed, which node is
// a pending connect source, which edge is selected, and whether edit mode is on.
// All of it is canvas DRAW STATE - render.js reads g.pendingSource, g.selectedEdge
// and g.vis every frame - so the machine mutates the context, asks for a repaint,
// and REPORTS via g.emitChange(). It never touches a button.
/** @typedef {import('../graph.js').GraphContext} GraphContext */
/**
 * Install the edit-mode state machine onto the shared context: g.setConnector /
 * g.markSource / g.clearPending / g.clearSelectedEdge / g.selectEdge /
 * g.setEditMode.
 *
 * Must run AFTER renderScene, because every mutator here ends in a repaint and
 * an emit, and both g.vis and g.requestDraw are renderScene's to create.
 * @param {GraphContext} g
 * @returns {void}
 */
export function attachEditState(g) {
    /**
     * Arm a connection type. Purely a state change now: which legend entry looks
     * armed is chrome-view.js's problem, derived from the emitted `connector`.
     * @param {string} type - 'prereq' | 'recnext'
     * @returns {void}
     */
    g.setConnector = function (type) {
        if (type !== 'prereq' && type !== 'recnext')
            return; // the only two the engine can draw
        if (g.activeConnector === type)
            return;
        g.activeConnector = type;
        g.emitChange();
    };
    /**
     * Remember the first node of a two-click connect gesture.
     * @param {string} id
     * @returns {void}
     */
    g.markSource = function (id) { g.pendingSource = id; g.requestDraw(); g.emitChange(); };
    g.clearPending = function () {
        if (g.pendingSource === null)
            return; // no repaint, no emit, for a no-op
        g.pendingSource = null;
        g.requestDraw();
        g.emitChange();
    };
    g.clearSelectedEdge = function () {
        if (g.selectedEdge === null)
            return;
        g.selectedEdge = null;
        g.requestDraw();
        g.emitChange();
    };
    /**
     * Select a drawn edge (the thing Delete then removes). Selecting an edge and
     * holding a pending source are mutually exclusive states, so this clears the
     * source itself rather than emitting twice through g.clearPending.
     * @param {string} from
     * @param {string} to
     * @param {string} type
     * @returns {void}
     */
    g.selectEdge = function (from, to, type) {
        g.pendingSource = null;
        g.selectedEdge = { from: from, to: to, type: type };
        g.requestDraw();
        g.emitChange();
    };
    /**
     * Enter or leave edit-connections mode, discarding any half-finished gesture.
     * @param {boolean} on
     * @returns {void}
     */
    g.setEditMode = function (on) {
        g.editMode = !!on;
        // One emit for the whole transition: the fields are written directly rather
        // than through clearPending/clearSelectedEdge so a subscriber never sees the
        // intermediate "edit mode on, stale edge still selected" state.
        g.pendingSource = null;
        g.selectedEdge = null;
        // Page links are inert while editing - they are not a connection the map can
        // create or delete, so drawing them would only offer a line that cannot be
        // clicked. This is draw state, not a legend class: chrome-view.js renders the
        // legend entry from the `visibility` it gets back.
        g.vis.pagelink = !g.editMode;
        g.requestDraw();
        g.emitChange();
    };
}
