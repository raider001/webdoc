import { projectFetch } from './project.js';
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

import { uniqueBy, uniqueStrings } from './lists.js';

export function normalizeTree(data: TreeLevel): TreeLevel {
  return { folders: uniqueStrings(data.folders), docs: uniqueBy(data.docs || [], doc => doc.id) };
}

// Render/effect retries share even failed requests. Retry belongs to a new
// index generation, never to an unrelated document rendering failure.
let cachedGeneration: number | undefined;
const levels = new Map<string, Promise<TreeLevel>>();
export function fetchChildren(path: string, generation = 0): Promise<TreeLevel> {
  if (generation !== cachedGeneration) { levels.clear(); cachedGeneration = generation; }
  const existing = levels.get(path);
  if (existing) return existing;
  const request = readChildren(path);
  levels.set(path, request);
  return request;
}

async function readChildren(path: string): Promise<TreeLevel> {
  try {
    const res = await projectFetch('/api/index/tree?path=' + encodeURIComponent(path || ''), { cache: 'no-cache' });
    if (!res.ok) return { folders: [], docs: [] };
    return normalizeTree(await res.json());
  } catch (e) { return { folders: [], docs: [] }; }
}
