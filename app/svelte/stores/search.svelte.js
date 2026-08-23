// search.svelte.js - state for the drawer's all-documents search results.
//
// The FETCHING stays in app/js/main.js on purpose: the 200ms debounce, the
// AbortController and the sequence guard are subtle, correct, and have nothing to
// do with rendering. (Both guards are needed - aborting only rejects the fetch,
// while a response that already parsed can still resolve late and overwrite a
// newer one.) This module holds only what the list needs to draw.

/** @typedef {import('/js/search.js').SearchResult} SearchResult */

/**
 * @typedef {Object} SearchState
 * @property {string} query
 * @property {SearchResult[]} hits
 * @property {boolean} searching - true between the debounce firing and the response landing
 */

/** @type {SearchState} */
export const searchState = $state({ query: '', hits: [], searching: false });

/** @param {string} query @returns {void} */
export function beginSearch(query) {
  searchState.query = query;
  searchState.searching = true;
}

/** @param {SearchResult[]} hits @returns {void} */
export function showHits(hits) {
  searchState.hits = hits;
  searchState.searching = false;
}
