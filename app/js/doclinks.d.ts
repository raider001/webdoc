import type { Doc } from './catalog.js';
/**
 * A doc->doc (or doc->external-node) edge reference: just the id pair, matching
 * the {from, to} shape GraphModel.traceEdges/pageLinks use (see map-view.js).
 */
export interface DocEdgeRef {
    from: string;
    to: string;
}
/**
 * A pseudo-node representing an external (non-doc) URL discovered in a doc
 * body, positioned off to the side of the doc layout and drawn as its own box.
 */
export interface ExternalLinkNode {
    /** "ext:" + the raw URL */
    id: string;
    url: string;
}
/**
 * The shape returned by documentLinks(): every in-body page-link edge found
 * across all docs, plus the external-URL nodes those edges point at.
 */
export interface DocLinksResult {
    pageLinks: DocEdgeRef[];
    externalNodes: ExternalLinkNode[];
}
/**
 * Resolve a relative reference (./ , ../ , bare sibling, or /source-root) against
 * the current document's id. Shared with the reader (main.js) so the map's link
 * classification and the in-body link routing never disagree.
 */
export declare function joinDocPath(baseId: string, rel: string): string;
/**
 * Resolve a RELATIVE in-body resource reference (an image src, mostly) to its URL
 * on the server. Doc resources live next to the .md under /docs/<source>/<dir>/, so
 * a relative ./ ../ path resolves there (via joinDocPath). External (scheme://,
 * protocol-relative //, data:) and root-absolute (/…) refs are the author's explicit
 * choice -> returns null (leave the src untouched). Shared by the reader (main.js)
 * and the editor so a relative image renders the same in both.
 */
export declare function resolveResourceUrl(baseId: string, src: string): string | null;
/**
 * Resolve an authored link target (relative, already-a-doc-id, or missing the
 * source-segment prefix) to a real doc id, case-insensitively.
 * @param path the raw link target (already stripped of any #anchor / .md)
 * @param baseId the doc doing the linking, for relative resolution
 * @param ids anything with .has(id) and .keys() (a Set of ids, or a Map keyed by id)
 */
export declare function resolveDocId(path: string, baseId: string | null, ids: Set<string> | Map<string, unknown>): string | null;
/**
 * Scan every doc's body for inline Markdown links and classify each as an
 * internal page-link edge, an external-URL node+edge, or a dropped dangling
 * link (see file header). Skips any pair already shown elsewhere on the map
 * (assumes/next/trace edges) and any duplicate edge.
 * @param traceEdges existing requirement-trace edges to exclude as dupes
 */
export declare function documentLinks(docs: Doc[], traceEdges: DocEdgeRef[]): DocLinksResult;
