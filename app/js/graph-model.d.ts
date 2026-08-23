/**
 * A slimmed-down document reference (id/title/description/assumes/next) produced
 * for every node in this module's GraphModel; authoring.js reuses this same list,
 * unmodified, as the 'all documents' data the editor's Assumed-knowledge/
 * Recommended-next pickers (editor/panels.js's docPicker) render as selectable options.
 */
export interface GraphDocNode {
    id: string;
    title: string;
    description: string;
    assumes: string[];
    next: string[];
    /** names of the access groups that may read it ([] = unrestricted) */
    groups: string[];
    /** this account may see the node but not open the page */
    locked: boolean;
    /** the doc declares its own rule rather than inheriting one down a "Recommended next" chain (decoded from the payload; nothing consumes it yet) */
    ownsAccess: boolean;
}
/**
 * The server-backed document graph, fetched once and cached by fetchGraphModel()/
 * ensureGraphModel() from GET /api/index/graph, reshaping the server's compact
 * node/edge-tuple response into named collections. Distinct from the internal
 * `GraphBuildModel` used by the graph/*.js rendering pipeline.
 */
export interface GraphModel {
    docs: GraphDocNode[];
    traceEdges: {
        from: string;
        to: string;
    }[];
    pageLinks: {
        from: string;
        to: string;
    }[];
    externalNodes: {
        id: string;
        url: string;
    }[];
    /** every access group named anywhere in this payload, in the index order the node tuples reference */
    groups: string[];
}
/** Drop the cached graph model so the next ensureGraphModel() call refetches it. */
export declare function invalidateGraphModel(): void;
/**
 * The wire shape GET /api/index/graph answers with: positional tuples rather
 * than objects, because this is one row per node and per edge for the WHOLE
 * corpus and the field names would dominate the payload. Every collection is
 * optional - an empty index, or a server predating a field, simply omits it,
 * which is why each read below defaults.
 */
export interface GraphIndexPayload {
    /** [id, title, description, flags, groupIndexes] */
    nodes?: [string, string, string, number?, number[]?][];
    /** [from, to, kind]; kind 0 = prereq, anything else = recommended-next */
    edges?: [number, number, number][];
    /** requirement-trace edges, as node indexes */
    traces?: [number, number][];
    /** [from, toNode, toExternal]; the unused end is -1 */
    pageLinks?: [number, number, number][];
    /** external URLs, indexed by a pageLinks tuple's third field */
    externals?: string[];
    /** access-group names, indexed by a node tuple's fifth field */
    groups?: string[];
}
/**
 * The cached, server-backed graph model: fetched at most once until
 * invalidateGraphModel() clears it (after an edit/create/delete updates the
 * server index).
 */
export declare function ensureGraphModel(): Promise<GraphModel>;
