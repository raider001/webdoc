<!--
  The drawer's "All documents" tree: the root level, plus the first source
  auto-opened.

  Mounted into #treeList, which app/index.html declares and main.js owns. This
  component never touches the drawer itself - #doc-tree, #scrim, the hamburger's
  aria-expanded, the focus restore and the Escape handler all stay vanilla in
  main.js. A mounted component cannot set attributes on the element it was
  mounted into, and the drawer's focus management is correct as it stands.
-->
<script lang="ts">
  import { fetchChildren, type TreeLevel } from '/js/tree.js';
  import { treeState } from './stores/tree.svelte.js';
  import DocLink from './DocLink.svelte';
  import TreeFolder from './TreeFolder.svelte';

  interface Props {
    onSelect: (id: string) => void;
  }

  let { onSelect }: Props = $props();

  let root: TreeLevel = $state({ folders: [], docs: [] });
  let loaded = $state(false);

  $effect(() => {
    const gen = treeState.generation;
    let cancelled = false;
    fetchChildren('').then(data => {
      if (cancelled) return;
      root = data;
      loaded = true;
      // Open the first source by default, matching the old renderTree(). Only on
      // the very first load: doing it on every generation bump would re-open a
      // source the reader had deliberately collapsed.
      const first = data.folders[0];
      if (first && treeState.expanded[first] === undefined) treeState.expanded[first] = true;
    });
    void gen;
    return () => { cancelled = true; };
  });
</script>

{#if loaded}
  {#each root.folders as folder (folder)}
    <TreeFolder name={folder} path={folder} {onSelect} />
  {/each}
  {#each root.docs as doc (doc.id)}
    <DocLink {doc} {onSelect} />
  {/each}
{/if}
