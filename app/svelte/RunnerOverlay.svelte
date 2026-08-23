<!--
  The test runner: a full-screen checklist, one grid per test case.

  WHAT THIS PORT ACTUALLY REMOVES. The hand-built runner kept three functions
  whose only job was to push state back into DOM it had already built -
  updateProgress() rewriting the counter in the top bar, syncPill() recomputing
  one card's Pass/Fail badge, and sync() inside pfControl() re-deciding which of
  two buttons is lit - and every handler had to remember to call the right ones
  in the right order. All three are gone: `model` is $state, the counter and the
  badges are $derived from it, and a click just records what happened.

  WHAT IT DELIBERATELY DOES NOT TOUCH is the "Actual response" box and the notes
  box. Those are contenteditable, they are created once by `use:richtext`, and
  nothing ever re-renders them - see app/svelte/actions/richtext.js for why a
  reactive contenteditable eats the caret and the undo stack.

  DEFINITIONS COME FROM THE DOCUMENTS; ONLY THE OUTCOME IS STORED. The working
  model is pre-populated from the latest stored result so a re-run starts where
  the last one left off, and `dirty` gates which tests Save rewrites - a test
  nobody touched keeps whatever result is already in the sidecar. A test whose
  every step was cleared is DELETED from the sidecar rather than stored as an
  empty run.

  tests/test_coverage_ui.py pins `#runnerOverlay`, `body.is-running`,
  `section.run-test[data-test-id=…]`, the five `table.run-grid` headers and the
  two `.run-pf button.run-pf-btn` per step.
-->
<script>
  import { checkIcon, closeIcon } from '/js/icons.js';
  import { manualTests, saveManual } from '/js/coverage.js';
  import { sanitizeToFragment } from '/js/sanitize.js';
  import { icon } from './actions/icon.js';
  import { fragment } from './actions/fragment.js';
  import { richtext } from './actions/richtext.js';

  /** @typedef {import('/js/runner.js').RunTest} RunTest */
  /** @typedef {import('/js/requirements.js').TestCaseEntry} TestCaseEntry */
  /** @typedef {import('/js/coverage.js').CoverageResults} CoverageResults */

  /**
   * `results` is the caller's live object and is written THROUGH: saving edits
   * `results.manual` in place and hands that same map to saveManual(), exactly
   * as the hand-built runner did. It is a prop rather than component state
   * because main.js also uses it to refresh badges after onSaved().
   * @type {{
   *   tests: TestCaseEntry[],
   *   results: CoverageResults,
   *   sources: import('/js/catalog.js').SourceConfig[],
   *   onSaved: () => void,
   *   onClose: () => void,
   * }}
   */
  let { tests, results, sources, onSaved, onClose } = $props();

  const HEADERS = ['#', 'Action', 'Expected response', 'Actual response', 'Result'];

  /**
   * The working model. $state, and deeply so - a click on a Pass button mutates
   * one step and every derived below repaints itself.
   * @type {RunTest[]}
   */
  // svelte-ignore state_referenced_locally
  let model = $state(tests.map(t => {
    const ex = manualTests(results.manual[t.id]);
    const exSteps = ex.length ? (ex[0].steps || []) : [];
    return {
      id: t.id, name: t.name || t.id, verifies: t.verifies || [], dirty: false,
      notes: ex.length ? (ex[0].report || '') : '',
      steps: (t.steps || []).map((s, i) => ({
        action: s.action, expected: s.expected,
        actual: exSteps[i] ? (exSteps[i].response || '') : '',
        // Tri-state: null means "not recorded", which is NOT a failure.
        pass: (exSteps[i] && typeof exSteps[i].pass === 'boolean') ? exSteps[i].pass : null,
      })),
    };
  }));

  let by = $state(readTester());
  let status = $state('');

  /** @type {HTMLInputElement|undefined} */
  let byBox = $state();

  /**
   * The tester's name is remembered between runs. Storage can throw (private
   * mode, a blocked origin) and a name is not worth failing the screen over.
   * `window.localStorage` rather than the bare global: app/svelte/ is linted
   * with only the globals it actually declares.
   * @returns {string}
   */
  function readTester() {
    try { return window.localStorage.getItem('wd-tester') || ''; } catch { return ''; }
  }

  const progress = $derived.by(() => {
    let steps = 0, rec = 0, pass = 0, fail = 0;
    model.forEach(t => t.steps.forEach(s => {
      steps++;
      if (s.pass !== null) { rec++; if (s.pass) pass++; else fail++; }
    }));
    return model.length + ' test' + (model.length === 1 ? '' : 's') +
      ' · ' + rec + '/' + steps + ' steps recorded · ' + pass + ' pass, ' + fail + ' fail';
  });

  /**
   * A test is failing if ANY recorded step failed, passing if every recorded
   * step passed, and not run until something is recorded at all.
   * @param {RunTest} t
   * @returns {'pass'|'fail'|'untested'}
   */
  function testStatus(t) {
    let anySet = false, anyFail = false;
    t.steps.forEach(s => { if (s.pass !== null) { anySet = true; if (!s.pass) anyFail = true; } });
    if (!anySet) return 'untested';
    return anyFail ? 'fail' : 'pass';
  }

  /**
   * @param {'pass'|'fail'|'untested'} st
   * @returns {string}
   */
  function pillText(st) {
    return st === 'pass' ? 'Pass' : st === 'fail' ? 'Fail' : 'Not run';
  }

  /**
   * Clicking the lit button clears the step back to "not recorded", which is the
   * only way to undo a mis-click.
   * @param {number} ti
   * @param {number} si
   * @param {boolean} value
   * @returns {void}
   */
  function setPass(ti, si, value) {
    const step = model[ti].steps[si];
    step.pass = step.pass === value ? null : value;
    model[ti].dirty = true;
  }

  /**
   * The contenteditable's change callback. Addressed by INDEX rather than by a
   * captured object because `use:richtext` reads its parameters exactly once, so
   * this closure outlives any particular render of the row.
   * @param {number} ti
   * @param {number} si
   * @returns {(html: string) => void}
   */
  function onActual(ti, si) {
    return (html) => { model[ti].steps[si].actual = html; model[ti].dirty = true; };
  }

  /**
   * @param {number} ti
   * @returns {(html: string) => void}
   */
  function onNotes(ti) {
    return (html) => { model[ti].notes = html; model[ti].dirty = true; };
  }

  /**
   * Strip anything unsafe out of recorded HTML before it is stored. The field it
   * came from is a contenteditable, so its content is whatever the browser (or a
   * paste) put there - sanitizing on the way IN is what keeps the stored sidecar
   * safe for every later reader of it.
   * @param {string} html
   * @returns {string}
   */
  function cleanHtml(html) {
    const box = document.createElement('div');
    box.appendChild(sanitizeToFragment(String(html || '')));
    return box.innerHTML.trim();
  }

  /**
   * @returns {Promise<void>}
   */
  async function save() {
    const who = by.trim();
    try { window.localStorage.setItem('wd-tester', who); } catch { /* see readTester */ }
    const at = new Date().toISOString();
    model.forEach(t => {
      if (!t.dirty) return;   // untouched tests keep their existing result
      const anySet = t.steps.some(s => s.pass !== null);
      if (anySet) {
        // Keep EVERY definition step, in order (pass may be null = not recorded),
        // so the stored array stays index-aligned with the definition on re-read.
        results.manual[t.id] = {
          run: { at: at, by: who },
          steps: t.steps.map(s => ({ step: s.action, response: cleanHtml(s.actual), pass: s.pass })),
          report: cleanHtml(t.notes),
        };
      } else delete results.manual[t.id];
    });
    status = 'Saving…';
    const ok = await saveManual(results.manual, sources);
    status = ok ? 'Saved.' : 'Save failed.';
    if (ok) onSaved();
  }

  /**
   * @param {KeyboardEvent} ev
   * @returns {void}
   */
  function onKey(ev) {
    if (ev.key === 'Escape') onClose();
  }

  // The tester box takes focus, a beat after the overlay lands. Kept as a timer
  // rather than `autofocus` for the same reason SignInWall.svelte keeps one: an
  // immediate focus() competes with the layout the browser is still doing.
  $effect(() => {
    const t = window.setTimeout(() => { if (byBox) byBox.focus(); }, 30);
    return () => window.clearTimeout(t);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="runner-overlay" id="runnerOverlay" onkeydown={onKey}>
  <div class="runner-bar">
    <span class="runner-title">Test run</span>
    <span class="runner-progress">{progress}</span>
    <span style="flex:1"></span>
    <label class="runner-by-l">Tester <input class="runner-by" placeholder="name…" bind:value={by} bind:this={byBox} /></label>
    <span class="runner-status">{status}</span>
    <button type="button" class="btn" onclick={onClose}>Close</button>
    <button type="button" class="btn btn-primary" onclick={save}>Save run</button>
  </div>
  <div class="runner-body">
    <div class="runner-inner">
      {#if !model.length}
        <p class="runner-empty">No test cases to run. Author a test-case table first.</p>
      {/if}
      {#each model as t, ti (t.id)}
        <section class="run-test" data-test-id={t.id}>
          <div class="run-test-head">
            <h3>{t.name} <span class="tc-id">{t.id}</span></h3>
            <span class="run-test-pill tc-result tc-result-{testStatus(t)}">{pillText(testStatus(t))}</span>
          </div>
          {#if t.verifies.length}<p class="run-verifies">Verifies: {t.verifies.join(', ')}</p>{/if}
          <div class="req-scroll">
            <table class="run-grid">
              <thead><tr>{#each HEADERS as h (h)}<th>{h}</th>{/each}</tr></thead>
              <tbody>
                {#each t.steps as step, si (si)}
                  <tr>
                    <td class="run-no">{si + 1}</td>
                    <td class="run-action tc-md" use:fragment={{ text: step.action }}></td>
                    <td class="run-expected tc-md" use:fragment={{ text: step.expected }}></td>
                    <td class="run-actual" use:richtext={{ value: step.actual, onchange: onActual(ti, si), placeholder: 'What actually happened…' }}></td>
                    <td class="run-result-cell">
                      <div class="run-pf">
                        <button type="button" class="run-pf-btn run-pf-pass" class:is-on={step.pass === true} title="Pass" onclick={() => setPass(ti, si, true)} use:icon={checkIcon}></button>
                        <button type="button" class="run-pf-btn run-pf-fail" class:is-on={step.pass === false} title="Fail" onclick={() => setPass(ti, si, false)} use:icon={closeIcon}></button>
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <!--
            The control this labels is the contenteditable `use:richtext` appends
            below, which does not exist yet when the label is rendered and has no
            id to point `for` at. Reproduced as the hand-built runner had it.
          -->
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="run-notes-l">Notes</label>
          <div use:richtext={{ value: t.notes, onchange: onNotes(ti), placeholder: 'Notes for this run…', extraClass: 'run-notes' }}></div>
        </section>
      {/each}
    </div>
  </div>
</div>
