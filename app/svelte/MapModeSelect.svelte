<!--
  "Map by" - which connection TYPE drives the tree layout.

  A CUSTOM DROPDOWN, NOT A <select>, because each option carries its own coloured
  connection swatch and a native option list cannot draw one. That is the whole
  reason for the hand-rolled listbox; everything else here is the cost of it.

  IT NEVER HIDES AN EDGE. Every connection is still drawn whatever is picked -
  this chooses the spine the hierarchy is built along. Hiding a category is the
  edge legend's job, one component over.

  THE STACKED LABELS ARE LOAD-BEARING. All the labels are rendered into one grid
  cell and all but the current one are `visibility: hidden` (see
  `.graph-mapmode-label` in app/css/graph.css), so the button is always as wide
  as the widest option and picking a different mode never resizes the legend bar
  it sits in.

  Picking a mode relayouts, which replaces the canvas - but not this component,
  which lives outside the {#key} block. So it does have to re-render itself on a
  change, which it does from `current` like any other prop.
-->
<script lang="ts">
  import { icon } from './actions/icon.js';
  import { chevronDownIcon } from '/js/icons.js';

  interface MapMode {
    /** the layout mode: 'all' | 'recnext' | 'prereq' */
    value: string;
    label: string;
    /** the edge category whose colour/dash the swatch borrows */
    swatch: string;
  }

  interface Props {
    modes: MapMode[];
    current: string;
    onPick: (mode: string) => void;
  }

  let { modes, current, onPick }: Props = $props();

  /** Is the popup up? */
  let open = $state(false);

  /** The wrapper, so an outside click can be told from an inside one. */
  let wrap: HTMLElement | undefined = $state();

  const currentMode = $derived(modes.find(m => m.value === current) || modes[0]);

  // Close on a click anywhere else. Registered only WHILE open, so there is no
  // permanently attached document listener asking itself whether it applies -
  // the effect's cleanup is the removal, which is the half the hand-written
  // version had to remember by hand.
  //
  // No deferral is needed here even though the vanilla original used a
  // setTimeout: the effect runs after the click that opened the menu, so the
  // mousedown that preceded that click has already been and gone.
  $effect(() => {
    if (!open) return;
    const offClick = (e: MouseEvent) => {
      if (wrap && !wrap.contains(e.target as Node)) open = false;
    };
    document.addEventListener('mousedown', offClick);
    return () => document.removeEventListener('mousedown', offClick);
  });

  function pick(value: string): void {
    open = false;
    if (value !== current) onPick(value);
  }
</script>

<div class="graph-mapmode" bind:this={wrap}>
  <button
    type="button"
    class="graph-mapmode-btn"
    aria-haspopup="listbox"
    aria-expanded={open ? 'true' : 'false'}
    onclick={() => { open = !open; }}
  >Map: <span class="graph-legend-swatch {currentMode.swatch || 'all'}"></span><span class="graph-mapmode-label"
    >{#each modes as m (m.value)}<span class={m.value === current ? 'is-cur' : undefined}>{m.label}</span>{/each}</span
  ><span class="graph-mapmode-caret" use:icon={chevronDownIcon}></span></button>

  <div class="graph-mapmode-menu" role="listbox" hidden={!open}>
    {#each modes as m (m.value)}
      <button
        type="button"
        class="graph-mapmode-item"
        class:is-sel={m.value === current}
        role="option"
        aria-selected={m.value === current}
        onclick={() => pick(m.value)}
      ><span class="graph-legend-swatch {m.swatch || 'all'}"></span><span>{m.label}</span></button>
    {/each}
  </div>
</div>
