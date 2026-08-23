<!--
  One folder level of the lazy tree.

  Children are fetched from GET /api/index/tree?path= the first time the folder
  is opened, and never at boot - which is what keeps the drawer cheap on a corpus
  of tens of thousands of documents.

  Expansion lives in the store, not on this <details> element. That is the whole
  point of the phase: app/js/tree.js kept it as the DOM `open` attribute, so a
  rebuild (create a document, or the four-second change poll) wiped the container
  and collapsed everything the reader had opened.
-->
<script lang="ts">
  import { fetchChildren, type TreeLevel } from '/js/tree.js';
  import { treeState, toggleFolder } from './stores/tree.svelte.js';
  import DocLink from './DocLink.svelte';
  import TreeFolder from './TreeFolder.svelte';

  interface Props {
    name: string;
    path: string;
    onSelect: (id: string) => void;
  }

  let { name, path, onSelect }: Props = $props();

  let level: TreeLevel = $state({ folders: [], docs: [] });
  let loaded = $state(false);

  const open = $derived(!!treeState.expanded[path]);

  // Load on first open, and RELOAD whenever the generation counter moves - that
  // is how a create/delete refreshes an already-open folder without collapsing
  // it. Reading treeState.generation here is what subscribes this effect to it.
  $effect(() => {
    const gen = treeState.generation;
    if (!open) return;
    let cancelled = false;
    fetchChildren(path).then(data => {
      if (cancelled) return;
      level = data;
      loaded = true;
    });
    void gen;
    return () => { cancelled = true; };
  });

  function ontoggle(e: Event): void {
    const el = e.currentTarget as HTMLDetailsElement;
    if (el.open !== open) toggleFolder(path);
  }
</script>

<details data-path={path} {open} {ontoggle}>
  <summary>{name}</summary>
  <div class="group-children">
    {#if loaded}
      {#each level.folders as folder (folder)}
        <TreeFolder name={folder} path={path + '/' + folder} {onSelect} />
      {/each}
      {#each level.docs as doc (doc.id)}
        <DocLink {doc} {onSelect} />
      {/each}
    {/if}
  </div>
</details>
