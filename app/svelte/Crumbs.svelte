<!--
  The header breadcrumb, mounted into #crumbs.

  Replaces a single line of app/js/reader.js:
  `el('crumbs').textContent = doc.id.split('/').join(' › ')`. The output is the
  same text node - the trail is not a set of links, and never was: a doc id's
  leading segments are folders in the tree, not documents you can open.

  #crumbs itself (the nav, its class and its aria-label) is declared in
  app/index.html and stays there; a component cannot set attributes on the
  element it was mounted into.
-->
<script>
  /** @type {{ docId?: string }} */
  let { docId = '' } = $props();

  const trail = $derived(docId ? docId.split('/').join(' › ') : '');
</script>{trail}
