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
  let data;
  try { data = await res.json(); } catch (e) { return []; }
  return (data.results || []).map(r => ({ docId: r.id, title: r.title, snippet: r.snippet || '' }));
}
