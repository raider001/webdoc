<!--
  The edge-category legend: one toggle per kind of connection the map draws.

  A KEY THAT IS ALSO A SWITCH. Clicking an entry hides that category, which
  happens on the canvas, in the renderer - so `aria-pressed` and `.is-off` are
  the only evidence in the DOM that anything happened at all, and
  tests/test_map_ui.py asserts exactly those.

  IN EDIT MODE THE FIRST TWO ENTRIES CHANGE JOB: prereq and recnext stop being
  visibility toggles and become the connector picker, because the connection you
  are about to draw and the category you are looking at are the same two things.
  `.is-connector` / `.is-connector-active` are how that reads on screen, and
  app/css/graph.css makes the other categories inert while editing.

  NOTHING HERE WRITES ITS OWN LOOK. Both branches ask the controller and then
  redraw from the change event that comes back. Going the long way round is what
  keeps the legend honest when the engine overrules it - edit mode forcing page
  links off, say - instead of showing a state only this component believes in.

  It renders BUTTONS AND NOTHING ELSE: `.graph-legend` is MapOverlay's, because
  that bar also holds the "Map by" dropdown, and a component that owned the box
  would have to own its neighbour too.
-->
<script lang="ts">
  /**
   * `visibility` is the controller's per-category map, keyed the same way the
   * draw list is. A category it has never heard of reads as undefined, which is
   * not `false`, which is why "off" is tested as `=== false` rather than for
   * falsiness - an unknown key means "shown", not "hidden".
   */
  interface Props {
    kinds: [string, string][];
    visibility: Record<string, boolean>;
    editMode: boolean;
    connector: string;
    onToggle: (kind: string) => void;
  }

  let { kinds, visibility, editMode, connector, onToggle }: Props = $props();

  /** The two categories a reader can actually draw. */
  const CONNECTABLE: string[] = ['prereq', 'recnext'];
</script>

{#each kinds as [kind, label] (kind)}
  <button
    type="button"
    class="graph-legend-item"
    class:is-off={visibility[kind] === false}
    class:is-connector={editMode && CONNECTABLE.includes(kind)}
    class:is-connector-active={editMode && CONNECTABLE.includes(kind) && kind === connector}
    data-kind={kind}
    aria-pressed={visibility[kind] === false ? 'false' : 'true'}
    title="Toggle {label}"
    onclick={() => onToggle(kind)}
  ><span class="graph-legend-swatch {kind}"></span>{label}</button>
{/each}
