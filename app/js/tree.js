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
