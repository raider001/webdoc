<!--
  The header breadcrumb, mounted into #crumbs.

  One entry per segment of the page's id. Every segment but the last is a FOLDER,
  and every folder is a page (#/Docs/how-to), so those are links; the last
  segment is the page being read and stays plain text. Labels are the path
  segments themselves - the trail spells out where the page lives, which is what
  a reader scanning it wants, and needs no titles fetched for the ancestors.

  #crumbs itself (the nav, its class and its aria-label) is declared in
  app/index.html and stays there; a component cannot set attributes on the
  element it was mounted into.
-->
<script lang="ts">
  interface Props {
    docId?: string;
  }

  let { docId = '' }: Props = $props();

  const trail = $derived.by(() => {
    const parts = docId ? docId.split('/') : [];
    return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/'), last: i === parts.length - 1 }));
  });
</script>{#each trail as crumb, i (crumb.path)}{#if i}<span class="crumb-sep" aria-hidden="true">›</span>{/if}{#if crumb.last}<span aria-current="page">{crumb.name}</span>{:else}<a href="#/{crumb.path}">{crumb.name}</a>{/if}{/each}
