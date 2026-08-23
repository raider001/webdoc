<!--
  One document in the drawer tree.

  The markup is a deliberate, exact reproduction of app/js/tree.js's docLink():
  `a.doc-link[data-id]`, the `.is-locked` modifier, the `.doc-lock` badge, and
  `aria-current="page"` for the routed document. Those are not incidental - the
  Playwright suite selects on `#treeList a.doc-link[data-id='...']`, and
  app/css/app.css and app/css/auth.css style exactly these names. Preserving the
  DOM contract is what lets the whole existing suite keep passing across a
  rewrite of how this markup is produced.

  CSS OWNERSHIP NOTE for Phase 5: `.tree a.doc-link.is-locked` and `.doc-lock`
  live in app/css/auth.css (:139-140), which Phase 5 owns. The tree reads them.
  If that file is split, these two selectors must come with the tree, not with
  the auth screens.
-->
<script lang="ts">
  import { lockIcon } from '/js/icons.js';
  import { icon } from './actions/icon.js';
  import { treeState } from './stores/tree.svelte.js';
  import type { TreeDoc } from '/js/tree.js';

  interface Props {
    doc: TreeDoc;
    onSelect: (id: string) => void;
  }

  let { doc, onSelect }: Props = $props();

  const isActive = $derived(treeState.activeId === doc.id);
  const label = $derived(doc.title || doc.id.split('/').pop());

  let node: HTMLAnchorElement | undefined = $state();

  // Scroll the routed document into view. app/js/tree.js did this at the end of
  // markActive(); it has to be an effect here because the link may not exist yet
  // when the route resolves - the folder containing it might still be loading.
  $effect(() => {
    if (isActive && node) node.scrollIntoView({ block: 'nearest' });
  });

  function click(ev: MouseEvent): void {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;   // allow open-in-new-tab
    ev.preventDefault();
    onSelect(doc.id);
  }
</script>

<a
  bind:this={node}
  class="doc-link"
  class:is-locked={doc.locked}
  href="#/{doc.id}"
  data-id={doc.id}
  aria-current={isActive ? 'page' : undefined}
  title={doc.locked ? 'Restricted - your account cannot open this page' : undefined}
  onclick={click}
>{label}{#if doc.locked}<span class="doc-lock" aria-label="Restricted" use:icon={lockIcon}></span>{/if}</a>
