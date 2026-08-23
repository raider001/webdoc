import type { GraphContext } from '../graph.js';
/**
 * Attach the viewport API (pan/zoom transform, fit, zoom, focus/flash, search,
 * minimap) onto the shared context, as g.viewSize / g.applyTransform / g.fit /
 * g.zoomAround / g.zoomCenter / g.flash / g.focus / g.setCurrent / g.search /
 * g.buildMinimap / g.updateMinimap.
 */
export declare function attachView(g: GraphContext): void;
