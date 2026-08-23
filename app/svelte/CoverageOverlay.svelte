<!--
  The full-screen Test Coverage view: the status graph, the legend that filters
  it, the export button and the detail panel.

  MOUNTED INTO THE HOST'S STAGE. #covOverlay and its stage div are created at
  boot by app/js/overlays.js so that the modules which FILL them can stay lazy;
  this component is what fills the stage, and app/js/coverage-view.js mounts it
  on open and unmounts it on close. Unmounting rather than hiding is not tidiness
  - the graph runs a requestAnimationFrame loop and installs window.__graph, and
  tests/test_map_ui.py has a test whose entire point is that two canvas views are
  never live at once.

  WHAT THE GRAPH IS BUILT FROM. Requirements and test cases become nodes of ONE
  graph: each requirement is a node whose `assumes` are its parent requirements
  (the inverse of `traceFrom`), and each test case is a node whose `assumes` are
  the requirements it verifies - so a verifies link draws as a requirement -> test
  edge. That inversion is the whole trick, and it is why both pseudo-document
  lists are built here rather than by the graph engine.

  THREE THINGS SURVIVE A CLOSE AND REOPEN, and each is remembered by whoever owns
  it: the pan/zoom by ./actions/graph.js, the legend filter by this file's module
  block, and nothing else. The panel deliberately does not - the hand-built
  version hid it on every open, and reopening the map to find last week's report
  still on screen would be worse.
-->
<script module lang="ts">
  /**
   * The status keys currently filtered OUT, remembered across mount and unmount.
   *
   * Module state because the instance does not outlive the overlay: this
   * component is destroyed when the reader closes the view, and a filter that
   * silently reset itself would look like the toggle had failed. The pan/zoom is
   * remembered the same way, one layer down, in ./actions/graph.ts.
   */
  let rememberedOff: string[] = [];
</script>

<script lang="ts">
  import { state as appState } from '/js/app-shell.js';
  import { requirementList, testList, setCoverageStatus } from '/js/requirements.js';
  import { loadResults, combinedStatus } from '/js/coverage.js';
  import { graph } from './actions/graph.js';
  import CovLegend from './CovLegend.svelte';
  import CovExportButton from './CovExportButton.svelte';
  import ReportPanel from './ReportPanel.svelte';

  import type { CoverageResults } from '/js/coverage.js';
  import type { GraphInputDoc } from '/js/graph.js';
  import type { GraphApi, GraphActionParams } from './actions/graph.js';

  /**
   * `results` arrive already loaded: coverage-view.js awaits them before it
   * mounts, so the first frame is the real graph rather than an empty stage that
   * fills in. `onResults` hands a later reload back, because exportReport()
   * lives over there and must not build a report from a stale sidecar.
   */
  interface Props {
    results: CoverageResults;
    onResults: (r: CoverageResults) => void;
    onExport: () => void;
    onClose: () => void;
  }

  let { results: initialResults, onResults, onExport, onClose }: Props = $props();

  // A SEED, not a mirror - hence the ignore. The island is mounted afresh on
  // every open, so `initialResults` cannot change under this instance; what does
  // change is the reload below, and that writes `results` directly.
  // svelte-ignore state_referenced_locally
  let results: CoverageResults = $state(initialResults);

  /**
   * The rebuild token. requirementList() and testList() read plain Maps that
   * authoring.js rewrites behind Svelte's back, so a link or unlink changes
   * nothing Svelte can see. Bumping this is how a write says "ask again" - it is
   * read inside every derived below AND keys the graph's container, which is
   * what destroys and rebuilds the canvas.
   */
  let version = $state(0);

  let statusOff: string[] = $state(rememberedOff.slice());

  /** The selected node id, i.e. what the report panel is showing. */
  let selected = $state<string | null>(null);

  let api = $state<GraphApi | null>(null);

  const model = $derived.by(() => {
    // `version` is read for its DEPENDENCY, never for its value - hence `void`,
    // which says so and keeps TypeScript from reading the read as a mistake. It
    // has to happen inside THIS derivation, beside the untrackable
    // requirementList(), or a link or unlink would leave the model stale.
    void version;
    const reqs = requirementList();
    const tests = testList();
    return { reqs: reqs, tests: tests, status: combinedStatus(reqs, tests, results) };
  });

  // NARROW EFFECT 1 - keep the in-document badges in step with the map. The
  // requirement tables and test-case blocks in the article read their colour from
  // requirements/store.js, and this is the only thing that writes it.
  $effect(() => {
    setCoverageStatus(model.status);
  });

  // NARROW EFFECT 2 - recolour. Reading the status FIRST means the effect still
  // depends on it while the controller is arriving (the action's import is a
  // round trip), so the first status after that lands is not missed.
  $effect(() => {
    const status = model.status;
    if (api) api.setStatus(status);
  });

  // NARROW EFFECT 3 - the legend filter. Separate from the recolour on purpose:
  // toggling "Passing" off must not re-push the status map, and replacing the
  // status map must not re-apply the filter. One effect for both would do each
  // job twice and make either one's bugs look like the other's.
  $effect(() => {
    const hidden = new Set(statusOff);
    if (api) api.setStatusFilter(hidden);
  });

  // Escape: dismiss the report panel if it is up, otherwise close the whole
  // view. This lives here rather than in coverage-view.js because the component
  // only exists while the overlay is open - which is the guard the old
  // `if (!overlay.hidden)` listener had to write by hand, on a listener that was
  // then never removed.
  $effect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (selected !== null) selected = null;
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /**
   * Build the graph action's payload. Called from the markup INSIDE the {#key}
   * block, so every rebuild recomputes it from the current index; Svelte reads
   * an action's parameters untracked and exactly once, which is what makes that
   * safe rather than merely convenient.
   */
  function graphParams(): GraphActionParams {
    // Inverse traceability: a requirement's PARENTS are the requirements that
    // trace to it, and the graph draws an edge parent -> child from `assumes`.
    const parents: Record<string, string[]> = {};
    model.reqs.forEach(r => (parents[r.id] = []));
    model.reqs.forEach(p => (p.traceFrom || []).forEach(c => { if (parents[c]) parents[c].push(p.id); }));

    const reqNodes: GraphInputDoc[] = model.reqs.map(r => ({
      id: r.id, title: r.id, description: r.description, assumes: parents[r.id] || [], next: [],
    }));
    const testNodes: GraphInputDoc[] = model.tests.map(t => ({
      id: t.id,
      title: t.name || t.id,
      description: (t.steps || []).length + ' step' + ((t.steps || []).length === 1 ? '' : 's'),
      assumes: (t.verifies || []).slice(),
      next: [],
    }));

    // Which shape each node is drawn as. Built in one pass rather than by
    // mutation, so it is plainly a lookup table and not reactive state.
    const nodeKind = new Map<string, string>([
      ...model.reqs.map((r): [string, string] => [r.id, 'req']),
      ...model.tests.map((t): [string, string] => [t.id, 'test']),
    ]);

    return {
      docs: reqNodes.concat(testNodes),
      options: {
        nodeStatus: model.status, nodeKind: nodeKind,
        autoSize: true, maxNodeW: 360, maxNodeH: 240,   // size boxes to fit the largest node
        onSelect: (id) => { selected = id; },
        onActivate: (id) => { selected = id; },
      },
      onReady: (a) => { api = a; },
    };
  }

  function toggleStatus(key: string): void {
    const next = statusOff.includes(key) ? statusOff.filter(k => k !== key) : statusOff.concat(key);
    statusOff = next;
    rememberedOff = next;
  }

  /**
   * Refetch the sidecar after a write that only the server knows the outcome of
   * (connecting or disconnecting an automated test), then rebuild.
   *
   * `?? []` where this used to read `appState.site && appState.site.sources`:
   * loadResults declares `SourceConfig[]` but opens with `for (const s of
   * (sources || []))`, so a boot with no site.json yet was always handing it
   * null. An empty list walks the same path to the same empty result; the null
   * was never the point.
   */
  async function reloadResults(): Promise<void> {
    const r = await loadResults(appState.site?.sources ?? []);
    results = r;
    onResults(r);
    version++;
  }
</script>

{#if model.reqs.length}
  <!--
    The graph's container. {#key} is the rebuild: a link or unlink replaces the
    element, so the action tears the old controller down (saving its pan/zoom)
    and builds a new one. Patching a canvas scene in place is not a thing the
    engine offers, and pretending otherwise is how a stale edge survives an edit.
  -->
  {#key version}
    <div use:graph={graphParams()}></div>
  {/key}
{:else}
  <p class="cov-empty">No requirements found to test.</p>
{/if}

<CovLegend off={statusOff} onToggle={toggleStatus} />
<CovExportButton {onExport} />
<ReportPanel
  id={selected}
  {results}
  {version}
  onDismiss={() => { selected = null; }}
  onCloseView={onClose}
  onOpenNode={(id) => { selected = id; }}
  onChanged={() => { version++; }}
  onReload={reloadResults}
/>
