// islands/tree.js - the drawer island's mount surface.
//
// Purpose-built mount functions rather than raw component exports, so the shell
// never has to know Svelte's mount()/unmount() signature or hold an instance
// handle. Both targets (#treeList, #searchResults) are declared in
// app/index.html and live for the lifetime of the page, so neither island is
// ever torn down - which is exactly why unmount is not exposed here. Anything
// that IS torn down (a per-document island, an overlay) must return a handle;
// these two genuinely do not.
import { mount } from 'svelte';
import DocTree from '../DocTree.svelte';
import SearchHitList from '../SearchHitList.svelte';

/**
 * @param {Element} target
 * @param {(id: string) => void} onSelect
 * @returns {void}
 */
export function mountDocTree(target, onSelect) {
  mount(DocTree, { target: target, props: { onSelect: onSelect } });
}

/**
 * @param {Element} target
 * @param {(id: string) => void} onSelect
 * @returns {void}
 */
export function mountSearchHits(target, onSelect) {
  mount(SearchHitList, { target: target, props: { onSelect: onSelect } });
}
