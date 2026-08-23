// tree.svelte.ts - the drawer tree's shared state, as runes.
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
// The `.svelte.ts` extension is required - it is what tells the compiler to
// process runes in a plain module rather than treat $state as an undefined name.

export interface TreeState {
  /** the routed document, highlighted and scrolled to */
  activeId: string | null;
  /** folder path -> open, survives rebuilds */
  expanded: Record<string, boolean>;
  /** bumped to force every level to refetch */
  generation: number;
}

export const treeState: TreeState = $state({
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
 */
export function setActive(id: string | null): void {
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
 */
export function invalidateTree(): void { treeState.generation++; }

export function toggleFolder(path: string): void {
  treeState.expanded[path] = !treeState.expanded[path];
}
