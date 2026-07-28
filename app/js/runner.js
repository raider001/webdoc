// runner.js - the test runner: a checklist grid per test case.
// ---------------------------------------------------------------------------
// A full-screen run mode. Each test case shows its whole action / expected table
// at once; the tester records an ACTUAL response and Pass/Fail per step, plus
// notes. Saving writes the LATEST result per test into the per-source sidecar,
// with run metadata (when + who). Definitions come from the docs; only the run
// outcome is stored. Zero dependencies.
// ---------------------------------------------------------------------------
import { elem } from './dom.js';
import { html } from './html.js';
import { checkIcon, closeIcon } from './icons.js';
import { richText } from './editor.js';
import { manualTests, saveManual } from './coverage.js';
import { sanitizeToFragment } from './sanitize.js';
import { blockMarkdown } from './requirements.js';

/** @typedef {import('./main.js').RunnerOpts} RunnerOpts */

/**
 * One step's live run state inside a test's working model: the definition
 * (action/expected, both Markdown source, carried over unchanged from the
 * TestCaseEntry) plus what the tester has recorded this run.
 * @typedef {Object} RunStep
 * @property {string} action - Markdown source
 * @property {string} expected - Markdown source
 * @property {string} actual - the tester's recorded response, as HTML
 * @property {boolean|null} pass - null when not yet recorded
 */

/**
 * One test case's working run state, pre-populated from its latest stored
 * result (if any) so a re-run starts where the last one left off. `dirty`
 * gates which tests Save actually rewrites - untouched tests keep whatever
 * result is already stored.
 * @typedef {Object} RunTest
 * @property {string} id
 * @property {string} name
 * @property {string[]} verifies - requirement/test ids this test verifies
 * @property {boolean} dirty
 * @property {string} notes - HTML
 * @property {RunStep[]} steps
 */

/**
 * Who ran a test and when.
 * @typedef {Object} TestRunMeta
 * @property {string} at - ISO timestamp
 * @property {string} by - tester name
 */

/**
 * One test's stored manual run outcome, keyed by test id inside a per-source
 * manual-results sidecar (CoverageResults.manual).
 * @typedef {Object} TestRunRecord
 * @property {TestRunMeta} run
 * @property {{step: string, response: string, pass: boolean|null}[]} steps
 * @property {string} report - HTML
 */

/**
 * Sanitize (strip anything unsafe) and trim a run's recorded HTML before it
 * is stored.
 * @param {string} html
 * @returns {string}
 */
function cleanHtml(html) {
  const d = document.createElement('div');
  d.appendChild(sanitizeToFragment(String(html || '')));
  return d.innerHTML.trim();
}

/** @type {HTMLElement|null} */
let runnerEl = null;
/** Close and remove the run overlay, if one is open. @returns {void} */
export function closeRunner() {
  if (runnerEl) { runnerEl.remove(); runnerEl = null; document.body.classList.remove('is-running'); }
}

/**
 * Open the full-screen test-run overlay for a set of test cases.
 * @param {RunnerOpts} opts
 * @returns {void}
 */
export function openRunner(opts) {
  closeRunner();
  const tests = opts.tests || [];
  const results = opts.results || { auto: {}, manual: {} };

  // Working model, pre-populated from any existing latest result (so re-runs
  // start where the last one left off). `dirty` gates which tests get rewritten.
  /** @type {RunTest[]} */
  const model = tests.map(t => {
    const ex = manualTests(results.manual[t.id]);
    const exSteps = ex.length ? (ex[0].steps || []) : [];
    return {
      id: t.id, name: t.name || t.id, verifies: t.verifies || [], dirty: false,
      notes: ex.length ? (ex[0].report || '') : '',
      steps: (t.steps || []).map((s, i) => ({
        action: s.action, expected: s.expected,
        actual: exSteps[i] ? (exSteps[i].response || '') : '',
        pass: (exSteps[i] && typeof exSteps[i].pass === 'boolean') ? exSteps[i].pass : null
      }))
    };
  });

  // ---- top bar + body ----
  const byInput = elem('input', { class: 'runner-by', placeholder: 'name…' });
  try { byInput.value = localStorage.getItem('wd-tester') || ''; } catch (e) {}
  const prog = elem('span', 'runner-progress');
  const status = elem('span', 'runner-status');
  const save = elem('button', { type: 'button', class: 'btn btn-primary' }, 'Save run');
  const inner = elem('div', 'runner-inner');
  const overlay = elem('div', { class: 'runner-overlay', id: 'runnerOverlay' },
    elem('div', 'runner-bar',
      elem('span', 'runner-title', 'Test run'),
      prog,
      elem('span', { style: 'flex:1' }),
      elem('label', 'runner-by-l', 'Tester ', byInput),
      status,
      elem('button', { type: 'button', class: 'btn', onClick: closeRunner }, 'Close'),
      save),
    elem('div', 'runner-body', inner));

  function updateProgress() {
    let steps = 0, rec = 0, pass = 0, fail = 0;
    model.forEach(t => t.steps.forEach(s => { steps++; if (s.pass !== null) { rec++; s.pass ? pass++ : fail++; } }));
    prog.textContent = model.length + ' test' + (model.length === 1 ? '' : 's') + ' · ' + rec + '/' + steps + ' steps recorded · ' + pass + ' pass, ' + fail + ' fail';
  }

  /**
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
   * A two-button Pass/Fail toggle bound to one step (clicking the active one
   * clears it).
   * @param {RunStep} step
   * @param {() => void} onChange
   * @returns {HTMLElement}
   */
  function pfControl(step, onChange) {
    const p = elem('button', { type: 'button', class: 'run-pf-btn run-pf-pass', title: 'Pass' }, checkIcon());
    const f = elem('button', { type: 'button', class: 'run-pf-btn run-pf-fail', title: 'Fail' }, closeIcon());
    function sync() { p.classList.toggle('is-on', step.pass === true); f.classList.toggle('is-on', step.pass === false); }
    p.addEventListener('click', () => { step.pass = step.pass === true ? null : true; sync(); onChange(); });
    f.addEventListener('click', () => { step.pass = step.pass === false ? null : false; sync(); onChange(); });
    sync();
    return elem('div', 'run-pf', p, f);
  }

  /**
   * @param {RunTest} t
   * @returns {HTMLElement}
   */
  function drawTest(t) {
    const pill = elem('span', 'run-test-pill');
    function syncPill() { const st = testStatus(t); pill.className = 'run-test-pill tc-result tc-result-' + st; pill.textContent = st === 'pass' ? 'Pass' : st === 'fail' ? 'Fail' : 'Not run'; }
    const onChange = () => { t.dirty = true; syncPill(); updateProgress(); };

    const headers = ['#', 'Action', 'Expected response', 'Actual response', 'Result'];
    const rows = t.steps.map((s, i) => {
      const actualField = richText(s.actual, value => { s.actual = value; t.dirty = true; }, 'What actually happened…');
      const result = pfControl(s, onChange);
      return html`
        <tr>
          <td class="run-no">${i + 1}</td>
          <td class="run-action tc-md">${blockMarkdown(s.action)}</td>
          <td class="run-expected tc-md">${blockMarkdown(s.expected)}</td>
          <td class="run-actual">${actualField}</td>
          <td class="run-result-cell">${result}</td>
        </tr>
      `;
    });
    const table = html`
      <table class="run-grid">
        <thead><tr>${headers.map(x => html`<th>${x}</th>`)}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    const notes = richText(t.notes, value => { t.notes = value; t.dirty = true; }, 'Notes for this run…');
    notes.classList.add('run-notes');

    const card = elem('section', { class: 'run-test', 'data-test-id': t.id },
      elem('div', 'run-test-head', elem('h3', null, t.name + ' ', elem('span', 'tc-id', t.id)), pill),
      t.verifies.length && elem('p', 'run-verifies', 'Verifies: ' + t.verifies.join(', ')),
      elem('div', 'req-scroll', table),
      elem('label', 'run-notes-l', 'Notes'),
      notes);

    syncPill();
    return card;
  }

  if (!model.length) inner.appendChild(elem('p', 'runner-empty', 'No test cases to run. Author a test-case table first.'));
  else model.forEach(t => inner.appendChild(drawTest(t)));
  updateProgress();

  save.addEventListener('click', async () => {
    const by = byInput.value.trim();
    try { localStorage.setItem('wd-tester', by); } catch (e) {}
    const at = new Date().toISOString();
    model.forEach(t => {
      if (!t.dirty) return;   // untouched tests keep their existing result
      const anySet = t.steps.some(s => s.pass !== null);
      if (anySet) {
        // Keep EVERY definition step, in order (pass may be null = not recorded),
        // so the stored array stays index-aligned with the definition on re-read.
        const steps = t.steps.map(s => ({ step: s.action, response: cleanHtml(s.actual), pass: s.pass }));
        results.manual[t.id] = { run: { at: at, by: by }, steps: steps, report: cleanHtml(t.notes) };
      } else delete results.manual[t.id];
    });
    status.textContent = 'Saving…';
    const ok = await saveManual(results.manual, opts.sources);
    status.textContent = ok ? 'Saved.' : 'Save failed.';
    if (ok && typeof opts.onSaved === 'function') opts.onSaved();
  });

  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRunner(); });

  document.body.appendChild(overlay);
  document.body.classList.add('is-running');
  runnerEl = overlay;
  setTimeout(() => byInput.focus(), 30);
}
