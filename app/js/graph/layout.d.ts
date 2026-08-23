import type { LayoutOptions } from './util.js';
import type { GraphInputDoc } from '../graph.js';
/**
 * A node record inside GraphBuildModel's `nodes` Map: one per doc id ever
 * referenced, including ids referenced only as a dangling assumes/next target
 * (missing:true).
 */
export interface ModelGraphNode {
    id: string;
    missing: boolean;
    title: string;
    desc: string;
    /** the access groups that can read this document ([] = unrestricted) */
    groups: string[];
    /** this reader may see that it exists but not open it */
    locked: boolean;
}
/**
 * A directed edge in GraphBuildModel's `edges` array, derived from a doc's
 * assumes (prereq) or next (recnext) list; the pre-layout, pre-cycle-broken
 * source of truth for every prereq/recnext connection.
 */
export interface ModelGraphEdge {
    from: string;
    to: string;
    type: string;
}
/**
 * One edge after cycle-breaking. `from`/`to` keep the ORIGINAL direction (that's
 * what gets drawn and what the arrow head follows); `layoutFrom`/`layoutTo` are
 * the acyclic order the tree pass is allowed to walk. `_chain` is stamped on by
 * layoutComponent - the node-id chain the polyline runs through - and read back
 * by layoutGraph when it turns the chain into points.
 */
export interface CycleBrokenEdge {
    from: string;
    to: string;
    type: string;
    reversed: boolean;
    layoutFrom: string;
    layoutTo: string;
    _chain?: string[];
}
/**
 * The bundle returned by buildModel() and stashed as GraphContext.model: the
 * node map plus edges plus self loops, read pervasively by every graph/*.js
 * module for metadata lookups (missing/title/desc) independent of layout.
 * Distinct from the client-fetched `GraphModel` cached in map-view.js.
 */
export interface GraphBuildModel {
    nodes: Map<string, ModelGraphNode>;
    edges: ModelGraphEdge[];
    selfLoops: {
        id: string;
        type: string;
    }[];
}
/**
 * A positioned node as produced by layoutGraph()/focusLayout() into the
 * layout's `nodes` Map; this is what render.js draws and view.js/
 * interactions.js use for fit/focus/hit-testing.
 */
export interface LayoutNode {
    id: string;
    x: number;
    y: number;
    cx: number;
    cy: number;
    w: number;
    h: number;
}
/**
 * A routed edge as produced by layoutGraph()/focusLayout() into the layout's
 * `edges` array, carrying a polyline of world-space points for the canvas
 * renderer to stroke and arrow.
 */
export interface LayoutEdge {
    from: string;
    to: string;
    type: string;
    reversed: boolean;
    points: {
        x: number;
        y: number;
    }[];
    head: string;
}
/**
 * The overall return value of layoutGraph()/focusLayout(), stashed as
 * GraphContext.layout; extended in place by positionExternal (width/height
 * grown to fit external-link boxes) and consumed by every other graph module.
 */
export interface GraphLayoutResult {
    nodes: Map<string, LayoutNode>;
    edges: LayoutEdge[];
    width: number;
    height: number;
}
/**
 * Build the graph model from the flat docs list: one ModelGraphNode per real
 * doc plus a "missing" node for any id referenced only as a dangling
 * assumes/next target, and one ModelGraphEdge per assumes ("prereq", P -> D)
 * / next ("recnext", D -> S) reference (de-duplicated; a doc referencing
 * itself becomes a self-loop instead of an edge).
 */
export declare function buildModel(docs: GraphInputDoc[]): GraphBuildModel;
/**
 * One subtree's vertical extent per COLUMN, the thing that lets siblings nest
 * instead of stacking: `low` is the lowest (max) centre row the subtree reaches
 * at that depth, `high` the highest (min). Both are sparse - a subtree only has
 * entries for the columns it actually occupies - which is why stackBelow only
 * considers depths the two contours SHARE.
 */
export interface SubtreeContour {
    low: Map<number, number>;
    high: Map<number, number>;
}
/**
 * Position every node and route every edge as a polyline (Sugiyama-lite),
 * memoized per (node-id set, edge set, layoutMode, node size) so re-opening
 * an unedited map returns instantly instead of re-running the pipeline.
 * @param nodeList missing is informational only here
 * @param edgeList already de-duplicated by buildModel
 * @param opts tuning overrides; any field may be omitted (merged over the LO defaults)
 */
export declare function layoutGraph(nodeList: {
    id: string;
    missing?: boolean;
}[], edgeList: ModelGraphEdge[], opts?: Partial<LayoutOptions>): GraphLayoutResult;
/**
 * @param edgeList structural edges, drawn as straight rays (from/to/type)
 * @param neighborSet ids directly linked to centerId (any edge type)
 * @param opts tuning overrides; any field may be omitted (merged over the LO defaults)
 */
export declare function focusLayout(nodeList: {
    id: string;
}[], edgeList: ModelGraphEdge[], centerId: string, neighborSet: Set<string>, opts?: Partial<LayoutOptions>): GraphLayoutResult;
