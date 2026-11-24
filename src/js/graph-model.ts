import { projectFetch } from './project.js';
// graph-model.ts - the server-backed document graph MODEL: fetch it, reshape it,
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
  traceEdges: { from: string, to: string }[];
  pageLinks: { from: string, to: string }[];
  externalNodes: { id: string, url: string }[];
  /** every access group named anywhere in this payload, in the index order the node tuples reference */
  groups: string[];
}

let graphModel: GraphModel | null = null;
let revision = 0;
let pending: { revision: number; controller: AbortController; promise: Promise<GraphModel>; users: number } | null = null;
/** Drop the cached graph model so the next ensureGraphModel() call refetches it. */
export function invalidateGraphModel(): void {
  graphModel = null; revision++;
  pending?.controller.abort(); pending = null;
}
/** Guard a delayed consumer (such as a lazy overlay import) against stale publication. */
export function isCurrentGraphModel(model: GraphModel): boolean { return graphModel === model; }
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
 * Fetch the server's compact graph index (GET /api/index/graph) and reshape it
 * into a {@link GraphModel}. Errors leave the displayed model untouched.
 */
async function fetchGraphModel(signal: AbortSignal): Promise<GraphModel> {
  const res = await projectFetch('/api/index/graph', { cache: 'no-cache', credentials: 'same-origin', signal });
  if (!res.ok) throw new Error('Could not refresh the document map (' + res.status + ')');
  const g: GraphIndexPayload = await res.json();
  signal.throwIfAborted();
  const nodes = g.nodes || [];
  // Node tuples are [id, title, description, flags, groupIndexes]; fields 3 and 4
  // were appended for access control, so a payload without them still reads.
  // flags: bit 0 = locked (visible, not readable), bit 1 = declares its own rule
  // (as opposed to inheriting one down a "Recommended next" chain).
  const groupNames = g.groups || [];
  // Rebuild the docs[] that buildModel expects (assumes/next drive the hierarchy).
  const docs: GraphDocNode[] = nodes.map((n): GraphDocNode => ({
    id: n[0], title: n[1], description: n[2] || '', assumes: [], next: [],
    locked: !!((n[3] || 0) & 1),
    ownsAccess: !!((n[3] || 0) & 2),
    groups: (n[4] || []).map(i => groupNames[i]).filter(Boolean)
  }));
  for (const e of g.edges || []) {
    const f = e[0], t = e[1];
    if (!docs[f] || !docs[t]) continue;
    if (e[2] === 0) docs[t].assumes.push(docs[f].id);   // prereq [P,D,0]: D assumes P
    else docs[f].next.push(docs[t].id);                 // recnext [D,S,1]: D.next = S
  }
  const externals = g.externals || [];
  const externalNodes = externals.map(u => ({ id: 'ext:' + u, url: u }));
  const traceEdges = (g.traces || []).filter(e => nodes[e[0]] && nodes[e[1]]).map(e => ({ from: nodes[e[0]][0], to: nodes[e[1]][0] }));
  const pageLinks: { from: string, to: string }[] = [];
  for (const e of g.pageLinks || []) {
    const f = e[0]; if (!nodes[f]) continue;
    if (externals[e[2]]) pageLinks.push({ from: nodes[f][0], to: 'ext:' + externals[e[2]] });
    else if (nodes[e[1]]) pageLinks.push({ from: nodes[f][0], to: nodes[e[1]][0] });
  }
  return { docs: docs, traceEdges: traceEdges, pageLinks: pageLinks, externalNodes: externalNodes,
           groups: groupNames };
}
/**
 * The cached, server-backed graph model: fetched at most once until
 * invalidateGraphModel() clears it (after an edit/create/delete updates the
 * server index).
 */
export async function ensureGraphModel(signal?: AbortSignal): Promise<GraphModel> {
  while (true) {
    signal?.throwIfAborted();
    if (graphModel) return graphModel;
    if (pending?.controller.signal.aborted) pending = null;
    if (!pending) {
      const request = { revision, controller: new AbortController(), users: 0, promise: null! as Promise<GraphModel> };
      pending = request;
      request.promise = fetchGraphModel(request.controller.signal).then(model => {
        if (request.revision === revision) graphModel = model;
        return model;
      }).finally(() => { if (pending === request) pending = null; });
    }
    const request = pending;
    request.users++;
    let abort: (() => void) | undefined;
    let released = false;
    const release = () => { if (released) return; released = true; if (--request.users === 0 && pending === request) request.controller.abort(); };
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => { release(); reject(signal?.reason || new DOMException('Map closed', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
    });
    try {
      const model = await Promise.race([request.promise, cancelled]);
      signal?.throwIfAborted();
      if (request.revision === revision) return model;
    } catch (error) {
      if (signal?.aborted || request.revision === revision) throw error;
      // An index change superseded this request. All callers share its successor.
    } finally { if (abort) signal?.removeEventListener('abort', abort); release(); }
  }
}
