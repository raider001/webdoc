// search.js - all-documents search, now a thin client over the server's SQLite
// FTS5 index (GET /api/index/search). The old build-an-in-memory-index-from-every-
// body approach couldn't scale past a few thousand docs (it required loading every
// body at boot); full-text ranking now lives in the server and the browser only
// fetches the top matches. Ranked title-first by bm25 on the server.
// ---------------------------------------------------------------------------

/**
 * One ranked match from the server's FTS5 index, as resolved by searchDocs() below.
 * (The wire response from GET /api/index/search is `{ results: [{ id, title, snippet }] }`;
 * searchDocs() unwraps `results` and renames `id` to `docId` for consumers.)
 * @typedef {Object} SearchResult
 * @property {string} docId
 * @property {string} title
 * @property {string} snippet
 * @property {boolean} [locked] - the page exists but this account cannot open it
 */

/**
 * One row exactly as the server sends it. Kept separate from SearchResult
 * because the wire calls the document `id` and searchDocs() renames it - typing
 * the response is what stops that rename being applied to the wrong field.
 * @typedef {Object} SearchWireRow
 * @property {string} id
 * @property {string} title
 * @property {string} [snippet] - withheld for a `locked` hit
 * @property {boolean} [locked]
 */

/**
 * Returns a promise of [{ docId, title, snippet }]. `signal` (optional) is an
 * AbortController signal so the caller can cancel an in-flight request on the next
 * keystroke. A failed/aborted request resolves to [] (the caller shows empty state).
 * @param {string} query
 * @param {number} [limit]
 * @param {AbortSignal} [signal]
 * @returns {Promise<SearchResult[]>}
 */
export async function searchDocs(query, limit, signal) {
  const q = String(query || '').trim();
  if (!q) return [];
  let res;
  try {
    res = await fetch('/api/index/search?q=' + encodeURIComponent(q) + '&limit=' + (limit || 50),
      { cache: 'no-cache', signal: signal });
  } catch (e) {
    return [];   // aborted or network error
  }
  if (!res.ok) return [];
  /** @type {{results?: SearchWireRow[]}} */
  let data;
  try { data = await res.json(); } catch (e) { return []; }
  // `locked` marks a hit the reader may see listed but not open; the server
  // already withheld its snippet, and hidden documents never appear at all.
  return (data.results || []).map(r => ({ docId: r.id, title: r.title, snippet: r.snippet || '', locked: !!r.locked }));
}
