/**
 * One ranked match from the server's FTS5 index, as resolved by searchDocs() below.
 * (The wire response from GET /api/index/search is `{ results: [{ id, title, snippet }] }`;
 * searchDocs() unwraps `results` and renames `id` to `docId` for consumers.)
 */
export interface SearchResult {
    docId: string;
    title: string;
    snippet: string;
    /** the page exists but this account cannot open it */
    locked?: boolean;
}
/**
 * One row exactly as the server sends it. Kept separate from SearchResult
 * because the wire calls the document `id` and searchDocs() renames it - typing
 * the response is what stops that rename being applied to the wrong field.
 */
export interface SearchWireRow {
    id: string;
    title: string;
    /** withheld for a `locked` hit */
    snippet?: string;
    locked?: boolean;
}
/**
 * The wire response of GET /api/index/search. `results` is optional because the
 * read below defaults it: an error page, or a server predating the field, must
 * read as "no matches" rather than throwing inside the search box.
 */
export interface SearchResponse {
    results?: SearchWireRow[];
}
/**
 * Returns a promise of [{ docId, title, snippet }]. `signal` (optional) is an
 * AbortController signal so the caller can cancel an in-flight request on the next
 * keystroke. A failed/aborted request resolves to [] (the caller shows empty state).
 */
export declare function searchDocs(query: string, limit?: number, signal?: AbortSignal): Promise<SearchResult[]>;
