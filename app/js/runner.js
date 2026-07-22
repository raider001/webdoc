// runner.js - the test runner: a checklist grid per test case.
// ---------------------------------------------------------------------------
// A full-screen run mode. Each test case shows its whole action / expected table
// at once; the tester records an ACTUAL response and Pass/Fail per step, plus
// notes. Saving writes the LATEST result per test into the per-source sidecar,
// with run metadata (when + who). Definitions come from the docs; only the run
// outcome is stored. Zero dependencies.
// ---------------------------------------------------------------------------
import { richText } from './editor.js';
import { manualTests, saveManual } from './coverage.js';
import { sanitizeToFragment } from './sanitize.js';
import { blockMarkdown } from './requirements.js';

function cleanHtml(html) {
  const d = document.createElement('div');
  d.appendChild(sanitizeToFragment(String(html || '')));
  return d.innerHTML.trim();
}

let runnerEl = null;
export function closeRunner() {
  if (runnerEl) { runnerEl.remove(); runnerEl = null; document.body.classList.remove('is-running'); }
}

// opts: { tests:[{id,name,steps:[{action,expected}],verifies}], results, sources, onSaved() }
export function openRunner(opts) {
  closeRunner();
  const tests = opts.tests || [];
  const results = opts.results || { auto: {}, manual: {} };

  // Working model, pre-populated from any existing latest result (so re-runs
  // start where the last one left off). `dirty` gates which tests get rewritten.
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

  const overlay = document.createElement('div'); overlay.className = 'runner-overlay'; overlay.id = 'runnerOverlay';

  // ---- top bar ----
  const bar = document.createElement('div'); bar.className = 'runner-bar';
  const title = document.createElement('span'); title.className = 'runner-title'; title.textContent = 'Test run';
  const prog = document.createElement('span'); prog.className = 'runner-progress';
  const spacer = document.createElement('span'); spacer.style.flex = '1';
  const byLabel = document.createElement('label'); byLabel.className = 'runner-by-l'; byLabel.textContent = 'Tester ';
  const byInput = document.createElement('input'); byInput.className = 'runner-by'; byInput.placeholder = 'name…';
  try { byInput.value = localStorage.getItem('wd-tester') || ''; } catch (e) {}
  byLabel.appendChild(byInput);
  const status = document.createElement('span'); status.className = 'runner-status';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = 'Close';
  const save = document.createElement('button'); save.type = 'button'; save.className = 'btn btn-primary'; save.textContent = 'Save run';
  bar.append(title, prog, spacer, byLabel, status, cancel, save);
  overlay.appendChild(bar);

  // ---- body ----
  const body = document.createElement('div'); body.className = 'runner-body';
  const inner = document.createElement('div'); inner.className = 'runner-inner';
  body.appendChild(inner);
  overlay.appendChild(body);

  function updateProgress() {
    let steps = 0, rec = 0, pass = 0, fail = 0;
    model.forEach(t => t.steps.forEach(s => { steps++; if (s.pass !== null) { rec++; s.pass ? pass++ : fail++; } }));
    prog.textContent = model.length + ' test' + (model.length === 1 ? '' : 's') + ' · ' + rec + '/' + steps + ' steps recorded · ' + pass + ' pass, ' + fail + ' fail';
  }

  function testStatus(t) {
    let anySet = false, anyFail = false;
    t.steps.forEach(s => { if (s.pass !== null) { anySet = true; if (!s.pass) anyFail = true; } });
    if (!anySet) return 'untested';
    return anyFail ? 'fail' : 'pass';
  }

  function pfControl(step, onChange) {
    const wrap = document.createElement('div'); wrap.className = 'run-pf';
    const p = document.createElement('button'); p.type = 'button'; p.className = 'run-pf-btn run-pf-pass'; p.textContent = '✓'; p.title = 'Pass';
    const f = document.createElement('button'); f.type = 'button'; f.className = 'run-pf-btn run-pf-fail'; f.textContent = '✗'; f.title = 'Fail';
    function sync() { p.classList.toggle('is-on', step.pass === true); f.classList.toggle('is-on', step.pass === false); }
    p.addEventListener('click', () => { step.pass = step.pass === true ? null : true; sync(); onChange(); });
    f.addEventListener('click', () => { step.pass = step.pass === false ? null : false; sync(); onChange(); });
    wrap.append(p, f); sync();
    return wrap;
  }

  function drawTest(t) {
    const card = document.createElement('section'); card.className = 'run-test'; card.dataset.testId = t.id;
    const head = document.createElement('div'); head.className = 'run-test-head';
    const h = document.createElement('h3');
    h.appendChild(document.createTextNode(t.name + ' '));
    const idEl = document.createElement('span'); idEl.className = 'tc-id'; idEl.textContent = t.id; h.appendChild(idEl);
    const pill = document.createElement('span'); pill.className = 'run-test-pill';
    function syncPill() { const st = testStatus(t); pill.className = 'run-test-pill tc-result tc-result-' + st; pill.textContent = st === 'pass' ? 'Pass' : st === 'fail' ? 'Fail' : 'Not run'; }
    head.append(h, pill); card.appendChild(head);

    if (t.verifies.length) {
      const v = document.createElement('p'); v.className = 'run-verifies'; v.textContent = 'Verifies: ' + t.verifies.join(', ');
      card.appendChild(v);
    }

    const onChange = () => { t.dirty = true; syncPill(); updateProgress(); };

    const table = document.createElement('table'); table.className = 'run-grid';
    const thead = document.createElement('thead'); const htr = document.createElement('tr');
    ['#', 'Action', 'Expected response', 'Actual response', 'Result'].forEach(x => { const th = document.createElement('th'); th.textContent = x; htr.appendChild(th); });
    thead.appendChild(htr); table.appendChild(thead);
    const tbody = document.createElement('tbody');
    t.steps.forEach((s, i) => {
      const tr = document.createElement('tr');
      const n = document.createElement('td'); n.className = 'run-no'; n.textContent = String(i + 1); tr.appendChild(n);
      const a = document.createElement('td'); a.className = 'run-action tc-md'; a.appendChild(blockMarkdown(s.action)); tr.appendChild(a);
      const e = document.createElement('td'); e.className = 'run-expected tc-md'; e.appendChild(blockMarkdown(s.expected)); tr.appendChild(e);
      const act = document.createElement('td'); act.className = 'run-actual';
      act.appendChild(richText(s.actual, html => { s.actual = html; t.dirty = true; }, 'What actually happened…'));
      tr.appendChild(act);
      const res = document.createElement('td'); res.className = 'run-result-cell'; res.appendChild(pfControl(s, onChange)); tr.appendChild(res);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = document.createElement('div'); wrap.className = 'req-scroll'; wrap.appendChild(table); card.appendChild(wrap);

    const nl = document.createElement('label'); nl.className = 'run-notes-l'; nl.textContent = 'Notes';
    const notes = richText(t.notes, html => { t.notes = html; t.dirty = true; }, 'Notes for this run…'); notes.classList.add('run-notes');
    card.append(nl, notes);

    syncPill();
    return card;
  }

  if (!model.length) {
    const empty = document.createElement('p'); empty.className = 'runner-empty'; empty.textContent = 'No test cases to run. Author a test-case table first.';
    inner.appendChild(empty);
  } else {
    model.forEach(t => inner.appendChild(drawTest(t)));
  }
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

  cancel.addEventListener('click', closeRunner);
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRunner(); });

  document.body.appendChild(overlay);
  document.body.classList.add('is-running');
  runnerEl = overlay;
  setTimeout(() => byInput.focus(), 30);
}
