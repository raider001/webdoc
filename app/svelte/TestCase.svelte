<!--
  One test case, rendered INSIDE the article.

  An exact reproduction of buildTestCase() / testStepRow() in
  app/js/requirements/render.js: `figure#test-<ID>.req-group.test-case >
  figcaption.req-cap.tc-cap + p.tc-verifies + div.req-scroll >
  table.req-tbl.test-steps-tbl`, with the caption carrying the name, a monospace
  `span.tc-id`, the rolled-up `span.tc-result` pill and the `button.tc-run`.
  tests/test_coverage_ui.py selects on every one of those, and
  requirements.js's revealTest() finds the figure by its id.

  THE RUN BUTTON STAYS A CustomEvent. It dispatches `webdoc:run-test` on
  `document` exactly as the hand-built button did, and main.js listens. That is
  not laziness about wiring a callback down: the article is not Svelte's, this
  block is mounted into it from a placeholder the Markdown pipeline left behind,
  and an event is how a component in there reaches the shell WITHOUT either side
  importing the other. A prop would mean requirements/render.js had to know what
  running a test means, and the whole runner is lazily imported precisely so it
  does not.

  Step prose is author-written Markdown and is injected with `use:fragment`, not
  rendered by Svelte - see app/svelte/actions/fragment.js. `.tc-md` is what
  app/css/requirements.css uses to tidy the block margins inside a cell, so it
  goes on the cell the markdown lands in.

  The result pill reads `covStatus.version` alongside statusOf() so recording a
  run recolours it in place; see app/svelte/stores/coverage.svelte.ts.
-->
<script lang="ts">
  import { warningIcon, playIcon } from '/js/icons.js';
  import { statusOf, index } from '/js/requirements/store.js';
  import { cssSafe } from '/js/requirements/parse.js';
  import { icon } from './actions/icon.js';
  import { fragment } from './actions/fragment.js';
  import { covStatus } from './stores/coverage.svelte.js';

  import type { TestCaseDocBlock } from '/js/requirements/parse.js';

  /**
   * The parsed block, straight from requirements/store.js's groupsByDoc.
   */
  interface Props {
    block: TestCaseDocBlock;
  }

  let { block }: Props = $props();

  const HEADERS = ['#', 'Action', 'Expected response'];

  /** The test-case record. Hoisted only so the markup stays readable. */
  const rec = $derived(block.rec);

  /**
   * The rolled-up result, live. `untested` is the floor rather than "no pill":
   * a test nobody has run is a fact worth stating, and the neutral pill is what
   * says so.
   *
   * covStatus.version is read for its DEPENDENCY, never for its value - hence
   * `void`, which says so and keeps TypeScript from reading the read as a
   * mistake. It has to happen inside THIS derivation, beside the untrackable
   * statusOf(), or the pill would render once and then be stale forever.
   */
  const cur = $derived.by(() => {
    void covStatus.version;
    return statusOf(rec.id);
  });
  const st = $derived(cur ? cur.status : 'untested');
  const resultLabel = $derived(
    st === 'pass' ? 'Pass' : st === 'fail' ? 'Fail' : st === 'partial' ? 'Partial' : 'Untested'
  );

  /**
   * A test with no component or no key composed an id nothing can address, so it
   * gets neither an anchor nor a Run button - the runner is keyed by that id, and
   * offering to run something it cannot find would be a dead button.
   */
  const addressable = $derived(!!(rec.component && rec.key));
  const figId = $derived(addressable ? 'test-' + cssSafe(rec.id) : undefined);

  /**
   * The requirement route a Verifies entry points at. Missing records degrade to
   * a dead '#' rather than throwing; see ReqTable.svelte's reqHref for why an
   * exception inside mount() is the worse failure.
   */
  function reqHref(id: string): string {
    const target = index.get(id);
    return target ? '#/' + target.docId + '?req=' + encodeURIComponent(id) : '#';
  }

  /**
   * Ask the shell to open the runner for this test. `document` is the meeting
   * point on purpose - see the file header.
   *
   * Reached through `window.CustomEvent` rather than the bare global, as
   * Toc.svelte reaches window.CSS: the bundle's lint surface declares only the
   * globals the components actually rely on, and adding one to that list for a
   * constructor `window` already carries would be a shared-config change for no
   * behavioural gain.
   */
  function run(): void {
    document.dispatchEvent(new window.CustomEvent('webdoc:run-test', { detail: { testId: rec.id } }));
  }
</script>

<!-- Keyed by index throughout; see ReqTable.svelte for why an authored id is the
     wrong key for a list that is a parsed snapshot and never reorders. -->
<figure class="req-group test-case" id={figId}>
  <figcaption class="req-cap tc-cap">Test case — {rec.name} <span class="tc-id">{rec.id}</span><span class="tc-result tc-result-{st}">{resultLabel}</span>{#if addressable}<button type="button" class="tc-run" title="Run this test case" onclick={run}><span class="wd-mounted" use:icon={playIcon}></span>Run</button>{/if}</figcaption>
  {#if block.error}<p class="req-error"><span class="wd-mounted" use:icon={warningIcon}></span> {block.error}</p>{/if}
  <p class="tc-verifies">Verifies: {#if rec.verifies.length}{#each rec.verifies as id, i (i)}{#if i}, {/if}<a class="req-link" href={reqHref(id)}>{id}</a>{/each}{:else}<span class="req-none">—</span>{/if}</p>
  <div class="req-scroll">
    <table class="req-tbl test-steps-tbl">
      <thead><tr>{#each HEADERS as h (h)}<th>{h}</th>{/each}</tr></thead>
      <tbody>
        {#each rec.steps as step, i (i)}
          <tr>
            <td class="tc-stepno">{i + 1}</td>
            <td class="tc-md" use:fragment={{ text: step.action }}></td>
            <td class="tc-steps tc-md" use:fragment={{ text: step.expected }}></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</figure>
