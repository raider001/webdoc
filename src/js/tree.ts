// tree.ts - the SERVER CONTRACT for the drawer's lazy document tree.
//
// Reduced to one fetch in Phase 3. Everything that built DOM - renderTree,
// folderNode, docLink, markActive, cssEscape and the module-level onSelectCb -
// moved to app/svelte/{DocTree,TreeFolder,DocLink}.svelte and the rune store in
// app/svelte/stores/tree.svelte.js.
//
// What is left is the part that was never about rendering: one level of the tree,
// fetched from the server index, with a failure that degrades to an empty level
// rather than throwing. The components import this module through the native
// "/js/tree.js" specifier, so there is exactly one copy of it.

/**
 * One document reference as listed by a tree level - just enough to render a
 * link (id + display title). Distinct from the fuller `Doc` (catalog.ts) and
 * `GraphDocNode` (graph-model.ts) shapes: the server's GET /api/index/tree only
 * ever sends these two fields.
 */
export interface TreeDoc {
  id: string;
  title: string;
  /** present and true when this account may see the page exists but not read it */
  locked?: boolean;
}

/**
 * One folder level of the lazy tree, as returned by GET /api/index/tree: the
 * immediate child folder names plus the docs directly inside this folder.
 */
export interface TreeLevel {
  folders: string[];
  docs: TreeDoc[];
}

export async function fetchChildren(path: string): Promise<TreeLevel> {
  try {
    const res = await fetch('/api/index/tree?path=' + encodeURIComponent(path || ''), { cache: 'no-cache' });
    if (!res.ok) return { folders: [], docs: [] };
    return await res.json();
  } catch (e) { return { folders: [], docs: [] }; }
}
