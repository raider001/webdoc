import type { GraphContext } from '../graph.js';
/**
 * Install the edit-mode state machine onto the shared context: g.setConnector /
 * g.markSource / g.clearPending / g.clearSelectedEdge / g.selectEdge /
 * g.setEditMode.
 *
 * Must run AFTER renderScene, because every mutator here ends in a repaint and
 * an emit, and both g.vis and g.requestDraw are renderScene's to create.
 */
export declare function attachEditState(g: GraphContext): void;
