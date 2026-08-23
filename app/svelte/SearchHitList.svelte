<!--
  The drawer's search results list, mounted into #searchResults.

  The empty and searching states are the same two strings app/js/main.js used to
  append as `p.search-empty`, kept identical so the CSS and the reading
  experience are unchanged.

  #searchResults.hidden is toggled by main.js, not here: this component is
  mounted INTO that element, and a component cannot set an attribute on its own
  mount target.
-->
<script>
  import { searchState } from './stores/search.svelte.js';
  import SearchHit from './SearchHit.svelte';

  /** @type {{ onSelect: (id: string) => void }} */
  let { onSelect } = $props();
</script>

{#if searchState.searching}
  <p class="search-empty">Searching…</p>
{:else if !searchState.hits.length}
  <p class="search-empty">No documents match “{searchState.query}”.</p>
{:else}
  {#each searchState.hits as hit (hit.docId)}
    <SearchHit {hit} {onSelect} />
  {/each}
{/if}
