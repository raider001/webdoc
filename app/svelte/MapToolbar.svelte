<!--
  The four affordances that change how the map is FRAMED rather than what it
  contains: zoom in, zoom out, fit to view, and the focus toggle.

  They live in one component but not in one box - `.graph-controls` is
  bottom-right and `.graph-focus-toggle` is top-left - because where a control
  sits is app/css/graph.css's business and what it MEANS is this file's. Grouping
  them by meaning is what makes the split obvious the next time one is added.

  FOCUS IS NOT A CONTROLLER COMMAND, which is why it is a callback straight past
  the graph. Entering or leaving focus mode lays the whole graph out again
  (radially around one node, or back to the hierarchy), and a controller cannot
  become a different layout - the app answers by building a new one. There is
  nothing for the live instance to be told.
-->
<script>
  import { icon } from './actions/icon.js';
  import { plusIcon, minusIcon, fitIcon, focusIcon } from '/js/icons.js';

  /**
   * `onZoom` takes a FACTOR rather than a direction, matching the controller's
   * zoomBy() - so the two buttons differ by their argument and nothing else.
   * @type {{
   *   focusMode: boolean,
   *   onZoom: (factor: number) => void,
   *   onFit: () => void,
   *   onFocusToggle: () => void,
   * }}
   */
  let { focusMode, onZoom, onFit, onFocusToggle } = $props();

  /**
   * One zoom step. 1.25 in, its reciprocal out, so an in-then-out pair returns
   * to exactly the scale it started at.
   */
  const STEP = 1.25;
</script>

<div class="graph-controls">
  <button
    type="button"
    class="graph-ctrl-btn"
    aria-label="Zoom in"
    title="Zoom in"
    onclick={() => onZoom(STEP)}
  ><span class="wd-mounted" use:icon={plusIcon}></span></button>
  <button
    type="button"
    class="graph-ctrl-btn"
    aria-label="Zoom out"
    title="Zoom out"
    onclick={() => onZoom(1 / STEP)}
  ><span class="wd-mounted" use:icon={minusIcon}></span></button>
  <button
    type="button"
    class="graph-ctrl-btn"
    aria-label="Fit to view"
    title="Fit to view"
    onclick={onFit}
  ><span class="wd-mounted" use:icon={fitIcon}></span></button>
</div>

<button
  type="button"
  class="graph-focus-toggle"
  class:is-on={focusMode}
  aria-pressed={focusMode ? 'true' : 'false'}
  title="Focus mode: click a node to centre the map on it and its links (Esc resets)"
  onclick={onFocusToggle}
><span class="wd-mounted" use:icon={focusIcon}></span> Focus</button>
