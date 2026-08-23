// tree.js - the SERVER CONTRACT for the drawer's lazy document tree.
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
 * link (id + display title). Distinct from the fuller `Doc` (catalog.js) and
 * `GraphDocNode` (graph-model.js) shapes: the server's GET /api/index/tree only
 * ever sends these two fields.
 * @typedef {Object} TreeDoc
 * @property {string} id
 * @property {string} title
 * @property {boolean} [locked] - present and true when this account may see the page exists but not read it
 */
/**
 * One folder level of the lazy tree, as returned by GET /api/index/tree: the
 * immediate child folder names plus the docs directly inside this folder.
 * @typedef {Object} TreeLevel
 * @property {string[]} folders
 * @property {TreeDoc[]} docs
 */
/**
 * @param {string} path
 * @returns {Promise<TreeLevel>}
 */
export async function fetchChildren(path) {
    try {
        const res = await fetch('/api/index/tree?path=' + encodeURIComponent(path || ''), { cache: 'no-cache' });
        if (!res.ok)
            return { folders: [], docs: [] };
        return await res.json();
    }
    catch (e) {
        return { folders: [], docs: [] };
    }
}
