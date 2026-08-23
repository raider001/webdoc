<!--
  Find a document on the map.

  UNCONTROLLED ON PURPOSE - the value lives in the <input>, not in a rune. The
  search does not filter anything: it asks the engine to centre and flash the
  best match, so there is no state here for a component to be the source of
  truth about, and a `bind:value` would only give the query a second home.

  It also sits OUTSIDE the {#key} block that rebuilds the canvas, so a relayout
  (a mode switch, a new connection) no longer wipes what the reader typed. The
  hand-built chrome cleared it every time, because the whole chrome was rebuilt
  along with the graph.

  Both handlers do the same thing, and both are wanted: `input` searches as you
  type, and Enter re-runs the current query for a reader who typed, looked away
  and wants to be taken back to the match. Enter also has its default suppressed
  - a bare <input type="search"> inside a form would submit, and this one is only
  not inside a form today.
-->
<script>
  /** @type {{ onSearch: (query: string) => void }} */
  let { onSearch } = $props();
</script>

<div class="graph-search">
  <input
    type="search"
    placeholder="Find a document…"
    aria-label="Find a document in the map"
    autocomplete="off"
    oninput={(e) => onSearch(e.currentTarget.value)}
    onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSearch(e.currentTarget.value); } }}
  />
</div>
