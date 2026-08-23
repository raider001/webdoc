<!--
  The map's scene: one <canvas>, one controller, and nothing else.

  THIS COMPONENT IS THE GRAPH'S LIFETIME. It creates the controller on mount and
  destroys it on teardown, which makes it the single owner of the engine's rAF
  loop and of window.__graph - the hit-test hook tests/test_map_ui.py drives. A
  second live controller is not a cosmetic problem: it is two draw loops fighting
  over one global, which is the failure that test file exists to catch.

  IT RENDERS ITS OWN HOST DIV, and that is not decoration. The engine appends its
  <canvas> to the element it is handed, and Svelte destroys a block by walking
  the DOM from the block's start node to its end node - so a canvas that landed
  inside one of MapOverlay's block ranges would be swept away by a re-render that
  had nothing to do with it. A dedicated element Svelte never renders into makes
  that impossible rather than unlikely. `.graph-canvas-host` is `inset: 0` inside
  `.graph-root`, so the engine still measures the full stage.

  THE OWNER TOKEN. Svelte's {#key} creates the new branch BEFORE it destroys the
  old one (BranchManager#ensure calls #commit only after branching), so the
  outgoing instance's `onReady(null)` arrives AFTER the incoming one has already
  reported its controller. Handing the parent this instance's identity alongside
  the api is what lets it ignore a late null instead of blanking a controller
  that is on screen. It is the same identity check the engine makes before
  clearing window.__graph, for the same reason.
-->
<script>
  import { graphCanvas } from './actions/graph.js';

  /** @typedef {import('/js/graph.js').GraphInputDoc} GraphInputDoc */
  /** @typedef {import('/js/graph.js').GraphOptions} GraphOptions */
  /** @typedef {import('/js/graph.js').GraphController} GraphController */
  /** @typedef {import('/js/graph.js').GraphChangeEvent} GraphChangeEvent */
  /** @typedef {import('./actions/graph.js').GraphViewSnapshot} GraphViewSnapshot */

  /**
   * `docs` and `options` are read ONCE, when the action runs. A different model
   * or a different layout is a different controller, which is what the {#key}
   * around this component expresses - there is no prop here you can change to
   * re-lay-out a live graph, deliberately.
   * @type {{
   *   docs: GraphInputDoc[],
   *   options: GraphOptions,
   *   onReady: (api: GraphController|null, owner: object) => void,
   *   onChange: (ev: GraphChangeEvent) => void,
   *   onTeardown: (view: GraphViewSnapshot) => void,
   * }}
   */
  let { docs, options, onReady, onChange, onTeardown } = $props();

  /**
   * This instance's identity, handed up with every onReady so the parent can
   * tell "my controller has gone" from "an older instance's has".
   */
  const owner = {};

  /**
   * The change subscription, dropped the moment the controller does. The
   * controller clears its own listener list on destroy too; unsubscribing here
   * as well is what keeps this component's teardown complete on its own terms.
   * @type {(() => void)|null}
   */
  let unsubscribe = null;

  /**
   * The action's one call back into the component: a controller on create, null
   * on teardown.
   *
   * The first paint is pushed here rather than waited for. getEditState()
   * returns the same snapshot on('change') delivers, so the chrome can draw
   * itself from real state immediately instead of sitting on defaults until the
   * reader happens to toggle something.
   * @param {GraphController|null} api
   * @returns {void}
   */
  function ready(api) {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (api) {
      unsubscribe = api.on('change', onChange);
      onChange(api.getEditState());
    }
    onReady(api, owner);
  }
</script>

<div class="graph-canvas-host" use:graphCanvas={{ docs, options, onReady: ready, onTeardown }}></div>
