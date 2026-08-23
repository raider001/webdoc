<!--
  What the map says when there is nothing to map.

  A whole component for one sentence, because the alternative is an inline
  `{#if}` in MapOverlay.svelte that reads as an afterthought - and this is the
  first thing a reader sees on a brand-new site with no documents in it yet. It
  is drawn OVER the canvas (z-index 2, `inset: 0`), not instead of it: the
  controller is still built, still installs its hit-test hook, and still reports
  zero nodes, which is what makes "empty" observable rather than merely blank.
-->
<div class="graph-empty">No documents to map.</div>
