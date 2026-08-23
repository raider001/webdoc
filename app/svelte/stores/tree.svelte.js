// tree.svelte.js - the drawer tree's shared state, as runes.
//
// This replaces module-level globals in app/js/tree.js: `onSelectCb`, plus the
// `loaded` flag and `open` attribute that each folder <details> carried on its
// own DOM node. Keeping expansion in the DOM was what made the tree fragile -
// app/js/tree.js's renderTree() began with `container.textContent = ''`, so every
// rebuild (a document create, or the four-second external-change poll) threw the
// whole thing away and collapsed every folder the reader had opened.
//
// Holding it here instead means a rebuild is a data refresh, not a teardown: the
// components re-render, the expansion survives, and the reader keeps their place.
//
// The `.svelte.js` extension is required - it is what tells the compiler to
// process runes in a plain module rather than treat $state as an undefined name.

/**
 * @typedef {Object} TreeState
 * @property {string|null} activeId - the routed document, highlighted and scrolled to
 * @property {Object<string, boolean>} expanded - folder path -> open, survives rebuilds
 * @property {number} generation - bumped to force every level to refetch
 */

/** @type {TreeState} */
export const treeState = $state({
  activeId: null,
  // A plain object rather than a Set: $state proxies objects deeply, so writing
  // expanded[path] is reactive on its own. A Set would need SvelteSet.
  expanded: {},
  generation: 0,
});

/**
 * Mark the routed document. Also opens every ancestor folder, which is what
 * app/js/tree.js's markActive() did by walking the DOM and calling each
 * <details>'s _load(); here it is three lines of state and the components
 * follow.
 * @param {string|null} id
 * @returns {void}
 */
export function setActive(id) {
  treeState.activeId = id;
  if (!id) return;
  const parts = id.split('/');
  let path = '';
  for (let i = 0; i < parts.length - 1; i++) {
    path = path ? path + '/' + parts[i] : parts[i];
    treeState.expanded[path] = true;
  }
}

/**
 * Force every loaded level to refetch, WITHOUT collapsing anything.
 * Called after a create/delete and by the external-change poll.
 * @returns {void}
 */
export function invalidateTree() { treeState.generation++; }

/**
 * @param {string} path
 * @returns {void}
 */
export function toggleFolder(path) {
  treeState.expanded[path] = !treeState.expanded[path];
}
