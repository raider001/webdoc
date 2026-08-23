<!--
  One all-documents search result.

  Reproduces the markup app/js/main.js built with its html`` tagged template:
  `a.search-hit` with `.search-hit-title` and an optional `.search-hit-sub`, plus
  the `.is-locked` modifier. app/css/app.css and app/css/auth.css style those
  names, and the snippet is server-supplied plain text - it is inserted as TEXT,
  never as HTML, which is why no sanitizer is involved on this path.
-->
<script>
  /** @type {{ hit: {docId: string, title: string, snippet?: string, locked?: boolean}, onSelect: (id: string) => void }} */
  let { hit, onSelect } = $props();

  /** @param {MouseEvent} ev */
  function click(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
    ev.preventDefault();
    onSelect(hit.docId);
  }
</script>

<a class="search-hit" class:is-locked={hit.locked} href="#/{hit.docId}" onclick={click}>
  <span class="search-hit-title">{hit.title}</span>
  {#if hit.snippet}<span class="search-hit-sub">{hit.snippet}</span>{/if}
</a>
