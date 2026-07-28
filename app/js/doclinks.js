// doclinks.js - in-body markdown links for the map's "Page link" layer.
// ---------------------------------------------------------------------------
// Scans each document body for inline links [text](target) and classifies each:
//   * INTERNAL  - target resolves to another document id (incl. relative ./ ../
//                 and .md refs) -> a doc->doc "page link" edge, UNLESS that pair
//                 is already shown as a prerequisite (assumes), recommended-next
//                 (next) or requirement-trace edge (no dupes).
//   * EXTERNAL  - target is a real URL-scheme destination -> an external-link
//                 node (a box showing the URL) plus an edge to it.
//   * DANGLING  - an internal-looking link that resolves to nothing -> dropped,
//                 so the map can never navigate to a raw server path and 404.
// Zero dependencies; links inside code fences / spans / requirement blocks are
// ignored so they aren't mistaken for real links.
// ---------------------------------------------------------------------------

/**
 * @typedef {import("./catalog.js").Doc} Doc
 */

/**
 * A doc->doc (or doc->external-node) edge reference: just the id pair, matching
 * the {from, to} shape GraphModel.traceEdges/pageLinks use (see map-view.js).
 * @typedef {Object} DocEdgeRef
 * @property {string} from
 * @property {string} to
 */

/**
 * A pseudo-node representing an external (non-doc) URL discovered in a doc
 * body, positioned off to the side of the doc layout and drawn as its own box.
 * @typedef {Object} ExternalLinkNode
 * @property {string} id - "ext:" + the raw URL
 * @property {string} url
 */

/**
 * The shape returned by documentLinks(): every in-body page-link edge found
 * across all docs, plus the external-URL nodes those edges point at.
 * @typedef {Object} DocLinksResult
 * @property {DocEdgeRef[]} pageLinks
 * @property {ExternalLinkNode[]} externalNodes
 */

/**
 * An unordered-pair key ("a b", alphabetically ordered) so a<->b and b<->a
 * hash to the same exclusion/seen entry regardless of direction.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function pairKey(a, b) { return a < b ? a + ' ' + b : b + ' ' + a; }

/**
 * Resolve a relative reference (./ , ../ , bare sibling, or /source-root) against
 * the current document's id. Shared with the reader (main.js) so the map's link
 * classification and the in-body link routing never disagree.
 * @param {string} baseId
 * @param {string} rel
 * @returns {string}
 */
export function joinDocPath(baseId, rel) {
  rel = String(rel || '').replace(/\/+$/, '');
  let segs;
  if (rel.startsWith('/')) {                       // absolute within the source root
    segs = String(baseId || '').split('/').slice(0, 1);
    rel = rel.replace(/^\/+/, '');
  } else {                                          // relative to the doc's folder
    segs = String(baseId || '').split('/'); segs.pop();
  }
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (segs.length) segs.pop(); continue; }
    segs.push(seg);
  }
  return segs.join('/');
}
/**
 * Resolve a RELATIVE in-body resource reference (an image src, mostly) to its URL
 * on the server. Doc resources live next to the .md under /docs/<source>/<dir>/, so
 * a relative ./ ../ path resolves there (via joinDocPath). External (scheme://,
 * protocol-relative //, data:) and root-absolute (/…) refs are the author's explicit
 * choice -> returns null (leave the src untouched). Shared by the reader (main.js)
 * and the editor so a relative image renders the same in both.
 * @param {string} baseId
 * @param {string} src
 * @returns {string|null}
 */
export function resolveResourceUrl(baseId, src) {
  const s = String(src || '');
  if (!s || HAS_SCHEME.test(s) || s.startsWith('//') || s.startsWith('/')) return null;
  const joined = joinDocPath(baseId, s);            // "Docs/features/image.png"
  if (!joined) return null;
  return '/docs/' + joined.split('/').map(encodeURIComponent).join('/');
}
/**
 * Resolve an authored link target (relative, already-a-doc-id, or missing the
 * source-segment prefix) to a real doc id, case-insensitively.
 * @param {string} path - the raw link target (already stripped of any #anchor / .md)
 * @param {string|null} baseId - the doc doing the linking, for relative resolution
 * @param {Set<string>|Map<string,*>} ids - anything with .has(id) and .keys() (a Set of ids, or a Map keyed by id)
 * @returns {string|null}
 */
export function resolveDocId(path, baseId, ids) {
  if (!path || !ids) return null;
  const match = c => {
    if (!c) return null;
    if (ids.has(c)) return c;
    const lc = c.toLowerCase();
    for (const id of ids.keys()) if (id.toLowerCase() === lc) return id;                   // case-insensitive
    return null;
  };
  if (baseId) { const hit = match(joinDocPath(baseId, path)); if (hit) return hit; }        // relative to the current doc
  const asIs = match(path); if (asIs) return asIs;                                           // already a full doc id
  const lower = path.replace(/^\.?\//, '').toLowerCase();                                    // authored without the source segment
  for (const id of ids.keys()) {
    const i = id.indexOf('/');
    if (i >= 0 && id.slice(i + 1).toLowerCase() === lower) return id;
  }
  return null;
}
const HAS_SCHEME = /^(?:[a-z][a-z0-9+.-]*:)/i;      // http:, mailto:, tel:, data:, …

/**
 * Scan every doc's body for inline Markdown links and classify each as an
 * internal page-link edge, an external-URL node+edge, or a dropped dangling
 * link (see file header). Skips any pair already shown elsewhere on the map
 * (assumes/next/trace edges) and any duplicate edge.
 * @param {Doc[]} docs
 * @param {DocEdgeRef[]} traceEdges - existing requirement-trace edges to exclude as dupes
 * @returns {DocLinksResult}
 */
export function documentLinks(docs, traceEdges) {
  const ids = new Set((docs || []).map(d => d.id));

  // Pairs already represented on the map by another category -> excluded.
  const exclude = new Set();
  for (const d of docs || []) {
    for (const p of d.assumes || []) exclude.add(pairKey(d.id, p));
    for (const s of d.next || []) exclude.add(pairKey(d.id, s));
  }
  for (const te of traceEdges || []) exclude.add(pairKey(te.from, te.to));

  const linkRe = /\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>]*>|[^()\s]+)/g; // [text](dest ...)
  const seenEdge = new Set();
  const pageLinks = [];
  const extById = new Map();

  for (const d of docs || []) {
    let body = String(d.body || '');
    body = body.replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, ''); // fenced code
    body = body.replace(/`[^`]*`/g, '');                                                // inline code
    body = body.replace(/<!--\s*meta\s+start[\s\S]*?<!--\s*meta\s+end\b[\s\S]*?-->/gi, ''); // req groups

    linkRe.lastIndex = 0;
    let m;
    while ((m = linkRe.exec(body)) !== null) {
      let target = m[1].trim();
      if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
      if (!target || target.charAt(0) === '#') continue; // empty or in-page anchor

      // Classify: resolve internal doc refs (incl. relative ./ ../ and .md) the
      // same way the reader does; only real URL-scheme targets are external.
      let resolved = null;
      if (!HAS_SCHEME.test(target)) {
        const hi = target.indexOf('#');
        const clean = (hi >= 0 ? target.slice(0, hi) : target).replace(/\.md$/i, '').replace(/\/+$/, '');
        resolved = resolveDocId(clean, d.id, ids);
      }

      if (resolved) {
        if (resolved === d.id) continue;                     // self-link
        if (exclude.has(pairKey(d.id, resolved))) continue;  // already shown elsewhere
        const ek = d.id + ' ' + resolved;
        if (seenEdge.has(ek)) continue;
        seenEdge.add(ek);
        pageLinks.push({ from: d.id, to: resolved });
      } else if (HAS_SCHEME.test(target)) {                  // a real external URL
        const extId = 'ext:' + target;
        if (!extById.has(extId)) extById.set(extId, { id: extId, url: target });
        const ek = d.id + ' ' + extId;
        if (seenEdge.has(ek)) continue;
        seenEdge.add(ek);
        pageLinks.push({ from: d.id, to: extId });
      }
      // else: a dangling internal-looking link -> dropped (no 404-able ext box).
    }
  }

  return { pageLinks: pageLinks, externalNodes: Array.from(extById.values()) };
}
