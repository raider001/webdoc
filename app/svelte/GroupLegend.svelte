<!--
  The access-group legend, shown only when something in the corpus is restricted.

  THE MAP IS WHERE A READER CAN SEE THE SHAPE OF WHAT IS LOCKED DOWN: which
  chapters share a group, where a restriction starts, and which pages they cannot
  open. Each entry dims every node readable only by that group, so "show me just
  what Ops can see" is one click rather than a trawl through page headers.

  PURELY VISUAL, AND THAT IS THE POINT. The server already decided what is in
  this payload at all; switching a group off changes what is EMPHASISED, never
  what is readable. The padlock the note mentions is drawn by the renderer on
  nodes this account may see but not open.

  Not a GroupChip.svelte: a chip is a `span.group-chip` label, and these are
  toggle buttons that happen to carry the same dot. They share the dot's colour
  function - groupColor() from /js/auth.js, external and shared with the vanilla
  shell - which is the part that actually has to agree everywhere.

  THE ONE THING WITH NO TEST UNDER IT. The fixture corpus has no access groups,
  so nothing in tests/ ever renders this component. Treat a change here as
  unnetted.
-->
<script lang="ts">
  import { groupColor, groupLabel } from '/js/auth.js';

  /**
   * `hidden` arrives as the Set inside the controller's change event, which is a
   * fresh copy on every emit - so this component re-renders because the whole
   * event object was REPLACED, never because a Set was mutated behind Svelte's
   * back. A plain `$state` Set would not have reported the difference.
   */
  interface Props {
    groups: string[];
    hidden: Set<string>;
    onToggle: (name: string) => void;
  }

  let { groups, hidden, onToggle }: Props = $props();
</script>

<div class="graph-groups">
  <p class="graph-groups-title">Access groups</p>
  {#each groups as name (name)}
    <button
      type="button"
      class="graph-group-item"
      class:is-off={hidden.has(name)}
      aria-pressed={hidden.has(name) ? 'false' : 'true'}
      title="Dim the pages only this group can read"
      onclick={() => onToggle(name)}
    ><span class="group-dot" style="background: {groupColor(name)}"></span>{groupLabel(name)}</button>
  {/each}
  <p class="graph-groups-note">A locked page shows a padlock: it exists, but your account cannot open it.</p>
</div>
