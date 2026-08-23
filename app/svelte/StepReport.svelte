<!--
  One step of a test case, as the coverage report panel shows it: the numbered
  action, the expected response, and - once somebody has actually run it - a
  pass/fail dot and the response they recorded.

  An exact reproduction of stepReport() in app/js/coverage-report.js:
  `div.tc-step(.is-pass|.is-fail) > div.tc-step-head > span.tc-step-n +
  div.tc-step-act.tc-md + span.tc-step-dot`, then `div.tc-step-exp`, then the
  optional `div.tc-step-actual`. The tint on the outer element is the only thing
  that says whether the step passed, so its modifier class is load-bearing.

  UNRECORDED IS NOT FAILED. `pass` is a tri-state - true, false, or null for "the
  tester never said" - and a run that stopped half way must not paint the rest of
  the steps red. That is why every branch here tests `typeof pass === 'boolean'`
  rather than truthiness.

  The action/expected are author-written Markdown and go in through
  `use:fragment`; the recorded response is HTML a previous run stored and goes in
  through `use:sanitized`. Both end at app/js/sanitize.js - see
  ./actions/richtext.js for why they are two different actions.
-->
<script>
  import { checkIcon, closeIcon } from '/js/icons.js';
  import { icon } from './actions/icon.js';
  import { fragment } from './actions/fragment.js';
  import { sanitized } from './actions/richtext.js';

  /**
   * `ex` is this step's recorded result, if the test has ever been run. It is
   * looked up by INDEX against the definition, which is why runner.js stores
   * every step in order even when some were left unrecorded.
   * @type {{
   *   step: import('/js/requirements.js').TestStep,
   *   index: number,
   *   ex?: {step?: string, response?: string, pass?: boolean|null},
   * }}
   */
  let { step, index, ex = undefined } = $props();

  const hasResult = $derived(!!ex && typeof ex.pass === 'boolean');
  const passed = $derived(!!ex && ex.pass === true);
  const response = $derived((ex && ex.response) || '');
</script>

<div class="tc-step" class:is-pass={hasResult && passed} class:is-fail={hasResult && !passed}>
  <div class="tc-step-head">
    <span class="tc-step-n">{index + 1}.</span>
    <div class="tc-step-act tc-md" use:fragment={{ text: step.action }}></div>
    {#if hasResult}<span class="tc-step-dot" use:icon={passed ? checkIcon : closeIcon}></span>{/if}
  </div>
  <div class="tc-step-exp"><div class="tc-step-lbl">Expected</div><div class="tc-md" use:fragment={{ text: step.expected }}></div></div>
  {#if response}<div class="tc-step-actual" use:sanitized={response}>Actual: </div>{/if}
</div>
