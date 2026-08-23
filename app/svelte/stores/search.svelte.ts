// search.svelte.ts - state for the drawer's all-documents search results.
//
// The FETCHING stays in app/js/main.js on purpose: the 200ms debounce, the
// AbortController and the sequence guard are subtle, correct, and have nothing to
// do with rendering. (Both guards are needed - aborting only rejects the fetch,
// while a response that already parsed can still resolve late and overwrite a
// newer one.) This module holds only what the list needs to draw.
import type { SearchResult } from '/js/search.js';

export interface SearchState {
  query: string;
  hits: SearchResult[];
  /** true between the debounce firing and the response landing */
  searching: boolean;
}

export const searchState: SearchState = $state({ query: '', hits: [], searching: false });

export function beginSearch(query: string): void {
  searchState.query = query;
  searchState.searching = true;
}

export function showHits(hits: SearchResult[]): void {
  searchState.hits = hits;
  searchState.searching = false;
}
