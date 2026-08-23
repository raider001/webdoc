// graph-model.js - the server-backed document graph MODEL: fetch it, reshape it,
// cache it, invalidate it. No DOM, no canvas, no renderer.
//
// Split out of map-view.js in Phase 2. The model and the map VIEW had no code in
// common, but they shared a file - and map-view.js statically imports graph.js
// and the whole graph/*.js rendering pipeline (~2,000 lines). So authoring.js
// asking "what document ids exist?" via ensureGraphModel(), and main.js dropping
// the cache after a file changed on disk, each dragged the entire canvas renderer
// into the eager boot graph for a question that never needed to draw anything.
//
// Everything here is a pure fetch-and-reshape over GET /api/index/graph.
// The map's data now comes from the server's SQLite index (GET /api/index/graph),
// not from scanning every loaded doc body. Fetched once per open and cached;
// invalidated after an edit/create/delete (which updates the server index).
/**
 * A slimmed-down document reference (id/title/description/assumes/next) produced
 * for every node in this module's GraphModel; authoring.js reuses this same list,
 * unmodified, as the 'all documents' data the editor's Assumed-knowledge/
 * Recommended-next pickers (editor/panels.js's docPicker) render as selectable options.
 * @typedef {Object} GraphDocNode
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string[]} assumes
 * @property {string[]} next
 * @property {string[]} groups - names of the access groups that may read it ([] = unrestricted)
 * @property {boolean} locked - this account may see the node but not open the page
 * @property {boolean} ownsAccess - the doc declares its own rule rather than inheriting one down a "Recommended next" chain (decoded from the payload; nothing consumes it yet)
 */
/**
 * The server-backed document graph, fetched once and cached by fetchGraphModel()/
 * ensureGraphModel() from GET /api/index/graph, reshaping the server's compact
 * node/edge-tuple response into named collections. Distinct from the internal
 * `GraphBuildModel` used by the graph/*.js rendering pipeline.
 * @typedef {Object} GraphModel
 * @property {GraphDocNode[]} docs
 * @property {{from: string, to: string}[]} traceEdges
 * @property {{from: string, to: string}[]} pageLinks
 * @property {{id: string, url: string}[]} externalNodes
 * @property {string[]} groups - every access group named anywhere in this payload, in the index order the node tuples reference
 */
/** @type {GraphModel|null} */
let graphModel = null;
/** Drop the cached graph model so the next ensureGraphModel() call refetches it. @returns {void} */
export function invalidateGraphModel() { graphModel = null; }
/**
 * The wire shape GET /api/index/graph answers with: positional tuples rather
 * than objects, because this is one row per node and per edge for the WHOLE
 * corpus and the field names would dominate the payload. Every collection is
 * optional - an empty index, or a server predating a field, simply omits it,
 * which is why each read below defaults.
 * @typedef {Object} GraphIndexPayload
 * @property {[string, string, string, number?, number[]?][]} [nodes] - [id, title, description, flags, groupIndexes]
 * @property {[number, number, number][]} [edges] - [from, to, kind]; kind 0 = prereq, anything else = recommended-next
 * @property {[number, number][]} [traces] - requirement-trace edges, as node indexes
 * @property {[number, number, number][]} [pageLinks] - [from, toNode, toExternal]; the unused end is -1
 * @property {string[]} [externals] - external URLs, indexed by a pageLinks tuple's third field
 * @property {string[]} [groups] - access-group names, indexed by a node tuple's fifth field
 */
/**
 * Fetch the server's compact graph index (GET /api/index/graph) and reshape it
 * into a {@link GraphModel}; falls back to an empty model on a network/parse error.
 * @returns {Promise<GraphModel>}
 */
async function fetchGraphModel() {
    /** @type {GraphModel} */
    const empty = { docs: [], traceEdges: [], pageLinks: [], externalNodes: [], groups: [] };
    /** @type {GraphIndexPayload} */
    let g;
    try {
        const res = await fetch('/api/index/graph', { cache: 'no-cache' });
        if (!res.ok)
            return empty;
        g = await res.json();
    }
    catch (e) {
        return empty;
    }
    const nodes = g.nodes || [];
    // Node tuples are [id, title, description, flags, groupIndexes]; fields 3 and 4
    // were appended for access control, so a payload without them still reads.
    // flags: bit 0 = locked (visible, not readable), bit 1 = declares its own rule
    // (as opposed to inheriting one down a "Recommended next" chain).
    const groupNames = g.groups || [];
    // Rebuild the docs[] that buildModel expects (assumes/next drive the hierarchy).
    /** @type {GraphDocNode[]} */
    const docs = nodes.map(n => /** @type {GraphDocNode} */ ({
        id: n[0], title: n[1], description: n[2] || '', assumes: [], next: [],
        locked: !!((n[3] || 0) & 1),
        ownsAccess: !!((n[3] || 0) & 2),
        groups: (n[4] || []).map(i => groupNames[i]).filter(Boolean)
    }));
    for (const e of g.edges || []) {
        const f = e[0], t = e[1];
        if (f < 0 || t < 0)
            continue;
        if (e[2] === 0)
            docs[t].assumes.push(docs[f].id); // prereq [P,D,0]: D assumes P
        else
            docs[f].next.push(docs[t].id); // recnext [D,S,1]: D.next = S
    }
    const externals = g.externals || [];
    const externalNodes = externals.map(u => ({ id: 'ext:' + u, url: u }));
    const traceEdges = (g.traces || []).filter(e => e[0] >= 0 && e[1] >= 0).map(e => ({ from: nodes[e[0]][0], to: nodes[e[1]][0] }));
    const pageLinks = [];
    for (const e of g.pageLinks || []) {
        const f = e[0];
        if (f < 0)
            continue;
        if (e[2] >= 0)
            pageLinks.push({ from: nodes[f][0], to: 'ext:' + externals[e[2]] });
        else if (e[1] >= 0)
            pageLinks.push({ from: nodes[f][0], to: nodes[e[1]][0] });
    }
    return { docs: docs, traceEdges: traceEdges, pageLinks: pageLinks, externalNodes: externalNodes,
        groups: groupNames };
}
/**
 * The cached, server-backed graph model: fetched at most once until
 * invalidateGraphModel() clears it (after an edit/create/delete updates the
 * server index).
 * @returns {Promise<GraphModel>}
 */
export async function ensureGraphModel() { if (!graphModel)
    graphModel = await fetchGraphModel(); return graphModel; }
