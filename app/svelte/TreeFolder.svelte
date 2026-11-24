<!--
  One folder level of the lazy tree.

  Children are fetched from GET /api/index/tree?path= the first time the folder
  is opened, and never at boot - which is what keeps the drawer cheap on a corpus
  of tens of thousands of documents.

  Expansion lives in the store, not on this <details> element. That is the whole
  point of the phase: app/js/tree.js kept it as the DOM `open` attribute, so a
  rebuild (create a document, or the four-second change poll) wiped the container
  and collapsed everything the reader had opened.

  The folder is a PAGE as well as a container. Its row holds two targets: the
  chevron (and the rest of the <summary>) expands and collapses it, and the
  label is a link to the folder's own page at #/<path> - which the router shows
  as the folder's page file if it has one (`page`, from the parent level) or as a
  generated listing if not. A link inside <summary> is its activation target, so
  following it does not also toggle the <details>; the click handler opens the
  folder explicitly, so the reader lands on the page with its contents showing.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { fetchChildren, normalizeTree, folderLabel, type TreeLevel, type TreeDoc } from '/js/tree.js';
  import { lockIcon } from '/js/icons.js';
  import { icon } from './actions/icon.js';
  import { treeState, setFolderOpen } from './stores/tree.svelte.js';
  import DocLink from './DocLink.svelte';
  import TreeFolder from './TreeFolder.svelte';

  interface Props {
    name: string;
    path: string;
    /** the document that is this folder's page, when it has one */
    page?: TreeDoc;
    onSelect: (id: string) => void;
  }

  let { name, path, page, onSelect }: Props = $props();

  let level: TreeLevel = $state({ folders: [], docs: [] });
  let loaded = $state(false);
  // Plain request data, outside runes: an effect replay must not publish a
  // freshly allocated level back into the same failed Svelte flush.
  let applied: TreeLevel | undefined;

  const open = $derived(!!treeState.expanded[path]);
  const label = $derived(folderLabel(name, page));
  // Active for the folder's own address, and for its page document reached by
  // its own id (#/Docs/how-to/README) - both are this folder's page.
  const isActive = $derived(treeState.activeId === path || (!!page && treeState.activeId === page.id));

  let link: HTMLAnchorElement | undefined = $state();
  $effect(() => {
    if (isActive && link) link.scrollIntoView({ block: 'nearest' });
  });

  // Becoming the page being read opens the folder, so the reader sees what its
  // page lists. Only on the transition: a reader who then collapses it is
  // obeyed, and a rebuild (the generation bump) does not reopen it.
  let wasActive = false;
  $effect(() => {
    if (isActive && !wasActive) untrack(() => setFolderOpen(path, true));
    wasActive = isActive;
  });

  // Load on first open, and RELOAD whenever the generation counter moves - that
  // is how a create/delete refreshes an already-open folder without collapsing
  // it. Reading treeState.generation here is what subscribes this effect to it.
  $effect(() => {
    const gen = treeState.generation;
    if (!open) return;
    let cancelled = false;
    const folderPath = path;
    untrack(() => fetchChildren(folderPath, gen)).then(data => {
      if (cancelled) return;
      if (applied === data) return;
      applied = data;
      level = normalizeTree(data);
      loaded = true;
    });
    void gen;
    return () => { cancelled = true; };
  });

  function ontoggle(e: Event): void {
    const el = e.currentTarget as HTMLDetailsElement;
    setFolderOpen(path, el.open);
  }

  function openPage(ev: MouseEvent): void {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;   // allow open-in-new-tab
    ev.preventDefault();
    setFolderOpen(path, true);
    onSelect(path);
  }
</script>

<details data-path={path} {open} {ontoggle}>
  <summary><span class="tree-chevron" aria-hidden="true"></span><a
    bind:this={link}
    class="folder-link"
    class:is-locked={page?.locked}
    href="#/{path}"
    data-path={path}
    aria-current={isActive ? 'page' : undefined}
    title={page?.locked ? 'Restricted - your account cannot open this page' : undefined}
    onclick={openPage}
  >{label}{#if page?.locked}<span class="doc-lock" aria-label="Restricted" use:icon={lockIcon}></span>{/if}</a></summary>
  <div class="group-children">
    {#if loaded}
      {#each level.folders as folder (folder)}
        <TreeFolder name={folder} path={path + '/' + folder} page={level.pages?.[folder]} {onSelect} />
      {/each}
      {#each level.docs as doc (doc.id)}
        <DocLink {doc} {onSelect} />
      {/each}
    {/if}
  </div>
</details>
