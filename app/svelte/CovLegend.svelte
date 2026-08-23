<!--
  The coverage map's status legend: four toggles, bottom-left.

  A FILTER, not a key. Switching an entry off hides every node of that status
  and every edge that touches one - which happens on the canvas, in the
  renderer, so `aria-pressed` and `.is-off` are the only evidence in the DOM
  that anything happened at all. tests/test_coverage_ui.py asserts aria-pressed
  rather than the class for exactly that reason: the class is how the entry is
  painted, aria-pressed is what it means.

  The component holds no state of its own. `off` comes down and `onToggle` goes
  up, because the same list has to survive the overlay closing and reopening -
  see CoverageOverlay.svelte's module block.
-->
<script lang="ts">
  /**
   * `off` is the list of status keys currently filtered OUT.
   */
  interface Props {
    off: string[];
    onToggle: (key: string) => void;
  }

  let { off, onToggle }: Props = $props();

  /**
   * Key + label, in the order the legend has always shown them. The key doubles
   * as the swatch modifier class and as what coverage.js calls the status.
   */
  const ENTRIES: [string, string][] = [['pass', 'Passing'], ['fail', 'Failing'], ['partial', 'Partial'], ['untested', 'Untested']];
</script>

<div class="cov-legend">
  {#each ENTRIES as [key, label] (key)}
    <button
      type="button"
      class="cov-legend-item"
      class:is-off={off.includes(key)}
      aria-pressed={off.includes(key) ? 'false' : 'true'}
      title="Toggle {label} requirements"
      onclick={() => onToggle(key)}
    ><span class="cov-swatch cov-swatch-{key}"></span>{label}</button>
  {/each}
</div>
