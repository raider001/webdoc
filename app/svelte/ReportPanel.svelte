<!--
  The coverage overlay's detail panel: what you get when you click a node.

  ONE PANEL, TWO REPORTS, chosen by the id's prefix exactly as showReport() in
  app/js/coverage-report.js chose it. A requirement (`R_…`) shows its
  description, a route into its document, its automated tests and the test cases
  that verify it. A test case (`T_…`) shows its rolled-up result, what it
  verifies, its steps with whatever the last run recorded, and a button to run it
  again.

  IT IS ALWAYS IN THE DOM, hidden when nothing is selected - not conditionally
  rendered. `.cov-report` is a fixed-width sheet with a drag grip on its left
  edge, and app/css/coverage.css hides it with `[hidden]`; keeping the element
  means the width a reader dragged it to survives being dismissed and reopened.
  tests/test_coverage_ui.py selects `aside.cov-report` and asserts it is hidden
  before a node is clicked.

  THE WIDTH IS SET IMPERATIVELY, and that is deliberate. A pointer drag fires
  dozens of times a second; routing each one through a rune would re-render the
  whole panel - every step, every list - to move one edge. The grip writes
  `style.width` straight onto the element it is dragging, which is what the
  hand-built version did, and nothing in the component reads it back.

  THE RUN BUTTON DISPATCHES `webdoc:run-test` on `document`, as TestCase.svelte's
  does: main.js listens, loads the runner lazily and opens it. A prop would drag
  the runner into this component's import graph for a button most readers never
  press.
-->
<script lang="ts">
  import { closeIcon, externalLinkIcon, playIcon } from '/js/icons.js';
  import { requirementList, testList } from '/js/requirements.js';
  import { computeTestStatus, manualTests } from '/js/coverage.js';
  import { icon } from './actions/icon.js';
  import StepReport from './StepReport.svelte';
  import AutomatedTests from './AutomatedTests.svelte';
  import VerifyingTests from './VerifyingTests.svelte';

  import type { CoverageResults } from '/js/coverage.js';

  /**
   * `id` is null when nothing is selected. `onCloseView` closes the whole
   * overlay (the "open in its document" links route away, so the map must go);
   * `onDismiss` only hides this panel.
   */
  interface Props {
    id: string | null;
    results: CoverageResults;
    version: number;
    onDismiss: () => void;
    onCloseView: () => void;
    onOpenNode: (id: string) => void;
    onChanged: () => void;
    onReload: () => Promise<void>;
  }

  let { id, results, version, onDismiss, onCloseView, onOpenNode, onChanged, onReload }: Props = $props();

  let panelEl = $state<HTMLElement | undefined>();

  /** Test ids are prefixed; that prefix is the whole of the routing decision. */
  const isTest = $derived(!!id && id.indexOf('T_') === 0);

  // `version` is read for its DEPENDENCY, never for its value - hence `void`,
  // which says so and keeps TypeScript from reading the read as a mistake. Each
  // read has to happen in the SAME derivation as the untrackable list call it
  // guards, or a link or unlink would leave the panel showing the old answer.
  // It stays BEHIND the early return, exactly where the comma operator had it:
  // a derivation that already knows its answer is null has nothing to redo.
  const req = $derived.by(() => {
    if (!id || isTest) return null;
    void version;
    return requirementList().find(r => r.id === id) || null;
  });
  const test = $derived.by(() => {
    if (!id || !isTest) return null;
    void version;
    return testList().find(t => t.id === id) || null;
  });

  /**
   * The rolled-up result for a test node. computeTestStatus over a one-element
   * list is how the hand-built panel asked, and it keeps the answer identical to
   * the one the map coloured the node with.
   */
  const testStatus = $derived.by(() => {
    if (!id || !isTest) return 'untested';
    const st = computeTestStatus(test ? [test] : [], results).get(id);
    return (st && st.status) || 'untested';
  });
  const testLabel = $derived(
    testStatus === 'pass' ? 'Pass' : testStatus === 'fail' ? 'Fail' : testStatus === 'partial' ? 'Partial' : 'Untested'
  );

  /** The stored record for this test, or undefined - both shapes are handled by manualTests(). */
  const record = $derived(id && isTest && results.manual ? results.manual[id] : null);

  /**
   * The recorded steps, INDEX-ALIGNED with the definition. An entry may be
   * missing (a run that stopped early) - StepReport paints that as "not
   * recorded", never as a failure.
   */
  const recorded = $derived.by(() => {
    // The null check is new only in SHAPE. manualTests declares
    // `ManualResultRecord` but opens with `if (!m) return []`, and this was
    // always calling it with null for a requirement node or an unrun test; the
    // guard says out loud what the callee was already doing.
    const ex = record ? manualTests(record) : [];
    return ex.length ? (ex[0].steps || []) : [];
  });

  const run = $derived(record ? record.run : null);
  const runLine = $derived.by(() => {
    if (!run) return '';
    const when = run.at && !isNaN(new Date(run.at).getTime()) ? new Date(run.at).toLocaleString() : '';
    return 'Last run' + (run.by ? ' by ' + run.by : '') + (when ? ' · ' + when : '');
  });

  const steps = $derived((test && test.steps) || []);

  /**
   * The document a requirement id lives in, for a Verifies link on a test
   * report. Undefined when the index has no such requirement, which reproduces
   * the hand-built href verbatim rather than inventing a guard the old one
   * did not have.
   *
   * Called from the markup, so the `version` read below still lands inside the
   * template's own tracked evaluation - the same reason the comma operator put
   * it here rather than at a call site.
   */
  function reqDoc(rid: string): string | undefined {
    void version;
    const rec = requirementList().find(r => r.id === rid);
    return rec ? rec.docId : undefined;
  }

  /**
   * Drag the panel's left edge. Bounded so it can neither collapse to nothing
   * nor swallow the map it is reporting on.
   */
  function startResize(ev: PointerEvent): void {
    ev.preventDefault();
    if (!panelEl) return;
    const panel = panelEl;
    const handle = ev.currentTarget as HTMLElement;
    const startX = ev.clientX;
    const startW = panel.getBoundingClientRect().width;
    // Pointer capture keeps the drag alive over the canvas, which swallows
    // pointer events for panning. A browser that refuses is not a reason to fail
    // the drag, so the failure is ignored exactly as it always was.
    try { handle.setPointerCapture(ev.pointerId); } catch { /* capture is an optimisation, not a requirement */ }
    const onMove = (move: PointerEvent) => {
      panel.style.width = Math.min(window.innerWidth - 60, Math.max(320, startW + (startX - move.clientX))) + 'px';
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  }

  function runTest(): void {
    document.dispatchEvent(new window.CustomEvent('webdoc:run-test', { detail: { testId: id } }));
  }
</script>

<aside class="cov-report" hidden={!id} bind:this={panelEl}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="cov-report-resize" title="Drag to resize" onpointerdown={startResize}></div>
  <div class="cov-report-head">
    <h2>{isTest ? (test ? test.name : id) : id}</h2>
    <button class="cov-report-close" title="Close" onclick={onDismiss} use:icon={closeIcon}></button>
  </div>

  <!--
    Keyed on the selected id, so switching nodes REBUILDS the body rather than
    patching it. That is what showReport() did (`panel.textContent = ''`), and it
    is the behaviour that matters: the two list sections below hold local UI
    state - a half-typed search, an open drop-down, the last "Linked T_…" notice
    - and carrying any of that across to a different requirement would be
    reporting one node's edit against another node's report.
  -->
  {#key id}
  {#if id && !isTest}
    {#if req && req.description}<p class="cov-report-desc">{req.description}</p>{/if}
    {#if req}
      <a class="cov-report-link" href="#/{req.docId}?req={id}" onclick={onCloseView}>Open in its document <span class="wd-mounted" use:icon={externalLinkIcon}></span></a>
    {/if}
    <AutomatedTests {id} {results} {onReload} />
    <VerifyingTests reqId={id} {results} {version} onOpenTest={onOpenNode} {onChanged} />
  {:else if id}
    <p class="cov-report-desc tc-report-sub"><code>{id}</code> <span class="tc-result tc-result-{testStatus}">{testLabel}</span></p>
    {#if test && test.verifies.length}
      <p class="cov-report-link">Verifies: {#each test.verifies as rid, i (rid)}{#if i}, {/if}<a href="#/{reqDoc(rid)}?req={rid}" onclick={onCloseView}>{rid}</a>{/each}</p>
    {/if}
    {#if test}
      <a class="cov-report-link" href="#/{test.docId}?test={id}" onclick={onCloseView}>Open in its document <span class="wd-mounted" use:icon={externalLinkIcon}></span></a>
    {/if}
    {#if runLine}<p class="cov-report-note">{runLine}</p>{/if}
    <div class="cov-report-sec">
      <h3>Steps ({steps.length})</h3>
      {#each steps as step, i (i)}
        <StepReport {step} index={i} ex={recorded[i]} />
      {/each}
    </div>
    <AutomatedTests {id} {results} {onReload} />
    <div class="cov-medit-bar">
      <button type="button" class="btn btn-primary" onclick={runTest}><span class="wd-mounted" use:icon={playIcon}></span>Run this test</button>
    </div>
  {/if}
  {/key}
</aside>
