// coverage-report.js - the detail panel of the Test Coverage view: what renders
// when you click a node. A requirement shows its automated tests + the test cases
// that verify it (with link/unlink); a test case shows its steps, recorded result,
// run metadata and a Run button. Split out of coverage-view.js to keep each under
// 400 lines. Everything the panel needs from the overlay (the panel element, the
// live results, rebuild + close) arrives through the `cov` context object.
import { elem, append } from './dom.js';
import { html } from './html.js';
import { state, app } from './app-shell.js';
import { requirementList, testList, blockMarkdown } from './requirements.js';
import { loadResults, computeTestStatus, testsFor, manualTests, connectAutomated, disconnectAutomated, rememberAutoUrl, fetchXUnitCatalog } from './coverage.js';
import { sanitizeToFragment } from './sanitize.js';
import { checkIcon, closeIcon, circleIcon, playIcon, externalLinkIcon } from './icons.js';

/** @typedef {import('./coverage-view.js').CovContext} CovContext */
/** @typedef {import('./requirements.js').RequirementEntry} RequirementEntry */
/** @typedef {import('./requirements.js').TestCaseEntry} TestCaseEntry */
/** @typedef {import('./requirements.js').TestStep} TestStep */
/** @typedef {import('./coverage.js').AutoTestCatalogEntry} AutoTestCatalogEntry */
/** @typedef {import('./coverage.js').AutoTestRef} AutoTestRef */

const glyph = (status) => status === 'pass' ? checkIcon() : status === 'fail' ? closeIcon() : circleIcon();
const statusDot = (status) => elem('span', 'cov-vtest-dot tc-result-' + status, glyph(status));
/**
 * One recorded step: the numbered action + expected response, the pass/fail dot
 * (once recorded) and the actual response (once run). The outer class carries
 * the pass/fail tint, so it stays elem() - everything inside it is static shape.
 * @param {TestStep} s - the step's action/expected definition
 * @param {number} i - zero-based step index
 * @param {{step?:string, response?:string, pass?:boolean|null}} [ex] - this step's recorded result, if any
 * @returns {HTMLElement}
 */
function stepReport(s, i, ex) {
  const hasResult = ex && typeof ex.pass === 'boolean';
  const resultDot = hasResult && elem('span', 'tc-step-dot', ex.pass ? checkIcon() : closeIcon());
  const actual = ex && ex.response && elem('div', 'tc-step-actual', 'Actual: ', sanitizeToFragment(ex.response));
  const body = html`
    <div class="tc-step-head">
      <span class="tc-step-n">${i + 1}.</span>
      <div class="tc-step-act tc-md">${blockMarkdown(s.action)}</div>
      ${resultDot}
    </div>
    <div class="tc-step-exp"><div class="tc-step-lbl">Expected</div><div class="tc-md">${blockMarkdown(s.expected)}</div></div>
    ${actual}
  `;
  return elem('div', 'tc-step' + (hasResult ? (ex.pass ? ' is-pass' : ' is-fail') : ''), body);
}

/**
 * The panel's header row: a title + a close (✕) button that hides the panel.
 * @param {string} title
 * @param {HTMLElement} panel
 * @returns {HTMLElement}
 */
function reportHead(title, panel) {
  return elem('div', 'cov-report-head',
    elem('h2', null, title),
    elem('button', { class: 'cov-report-close', title: 'Close', onClick: () => { panel.hidden = true; } }, closeIcon()));
}

/**
 * A node was selected: requirement -> its report; test case -> its test report.
 * @param {string} id
 * @param {CovContext} cov
 * @returns {void}
 */
export function showReport(id, cov) {
  if (id && id.indexOf('T_') === 0) return showTestReport(id, cov);
  const panel = cov.panel;
  const req = requirementList().find(r => r.id === id);
  panel.hidden = false;
  panel.textContent = '';
  panel.appendChild(cov.resizeHandle);   // re-attach the grip (textContent clear removed it)
  append(panel,
    reportHead(id, panel),
    req && req.description && elem('p', 'cov-report-desc', req.description),
    req && elem('a', { class: 'cov-report-link', href: '#/' + req.docId + '?req=' + id, onClick: () => cov.close() }, 'Open in its document ', externalLinkIcon()),
    buildAutomated(id, cov),
    buildVerifyingTests(id, cov));
}

/**
 * Test-case node clicked: show its definition (action/expected), the recorded
 * result (actual/pass) and run metadata, plus a "Run this test" button.
 * @param {string} id
 * @param {CovContext} cov
 * @returns {void}
 */
function showTestReport(id, cov) {
  const panel = cov.panel;
  const results = cov.results();
  const t = testList().find(x => x.id === id);
  const st = (computeTestStatus(t ? [t] : [], results).get(id)) || { status: 'untested' };
  const exSteps = (() => { const ex = manualTests(results.manual && results.manual[id]); return ex.length ? (ex[0].steps || []) : []; })();
  const run = results.manual && results.manual[id] && results.manual[id].run;

  panel.hidden = false;
  panel.textContent = '';
  panel.appendChild(cov.resizeHandle);
  append(panel, reportHead(t ? t.name : id, panel));

  const pillText = st.status === 'pass' ? 'Pass' : st.status === 'fail' ? 'Fail' : st.status === 'partial' ? 'Partial' : 'Untested';
  append(panel, elem('p', 'cov-report-desc tc-report-sub',
    elem('code', null, id), ' ', elem('span', 'tc-result tc-result-' + st.status, pillText)));

  if (t && t.verifies.length) {
    const line = elem('p', 'cov-report-link', 'Verifies: ');
    t.verifies.forEach((rid, i) => {
      if (i) append(line, ', ');
      const doc = (requirementList().find(r => r.id === rid) || {}).docId;
      append(line, elem('a', { href: '#/' + doc + '?req=' + rid, onClick: () => cov.close() }, rid));
    });
    append(panel, line);
  }
  if (t) append(panel, elem('a', { class: 'cov-report-link', href: '#/' + t.docId + '?test=' + id, onClick: () => cov.close() }, 'Open in its document ', externalLinkIcon()));
  if (run) {
    const when = run.at && !isNaN(new Date(run.at).getTime()) ? new Date(run.at).toLocaleString() : '';
    append(panel, elem('p', 'cov-report-note', 'Last run' + (run.by ? ' by ' + run.by : '') + (when ? ' · ' + when : '')));
  }

  const steps = (t && t.steps) || [];
  const sec = elem('div', 'cov-report-sec', elem('h3', null, 'Steps (' + steps.length + ')'));
  steps.forEach((s, i) => append(sec, stepReport(s, i, exSteps[i])));   // exSteps[i]: null = not recorded, don't paint it red
  append(panel, sec, buildAutomated(id, cov));

  append(panel, elem('div', 'cov-medit-bar',
    elem('button', { type: 'button', class: 'btn btn-primary', onClick: () => document.dispatchEvent(new CustomEvent('webdoc:run-test', { detail: { testId: id } })) }, playIcon(), ' Run this test')));
}

/**
 * The test cases that verify a requirement (its calculated Verified By): read-only
 * + clickable, plus a search box to LINK an existing test case (which adds this
 * requirement to that test's `verifies` in the test's doc). Test cases are authored
 * in documents / the editor, never here.
 * @param {string} reqId
 * @param {CovContext} cov
 * @returns {HTMLElement}
 */
function buildVerifyingTests(reqId, cov) {
  const results = cov.results();
  const h = elem('h3');
  const list = elem('div', 'cov-vtest-list');
  const inp = elem('input', { class: 'cov-vtest-search', placeholder: 'Search to link an existing test…' });
  const stEl = elem('span', 'cov-medit-status');
  const drop = elem('div', { class: 'cov-vtest-drop', hidden: true });
  const sec = elem('div', 'cov-report-sec cov-vtests', h, list, elem('div', 'cov-vtest-add', inp, stEl), drop);

  const tstatus = computeTestStatus(testList(), results);
  const statusOf = (tid) => (tstatus.get(tid) || {}).status || 'untested';
  const linkedIds = () => ((requirementList().find(r => r.id === reqId) || {}).verifiedBy) || [];

  function draw() {
    const linked = linkedIds();
    h.textContent = 'Test cases (' + linked.length + ')';
    list.textContent = '';
    if (!linked.length) append(list, elem('p', 'cov-report-empty', 'No test cases verify this requirement yet.'));
    linked.forEach(tid => {
      const t = testList().find(x => x.id === tid);
      const openBtn = elem('button', { type: 'button', class: 'cov-vtest-open', title: 'Open ' + tid, onClick: () => showReport(tid, cov) },
        statusDot(statusOf(tid)),
        elem('span', 'cov-vtest-name', t ? t.name : tid),
        elem('span', 'cov-vtest-id', tid));
      const rm = elem('button', {
        type: 'button', class: 'cov-vtest-rm', title: 'Unlink this test from the requirement',
        onClick: async () => {
          rm.disabled = true; stEl.textContent = 'Unlinking…';
          const ok = await app.unlinkTestFromRequirement(tid, reqId);
          stEl.textContent = ok ? 'Unlinked ' + tid : 'Unlink failed';
          if (ok) { draw(); cov.renderGraph(); } else rm.disabled = false;
        }
      }, closeIcon());
      append(list, elem('div', 'cov-vtest', openBtn, rm));
    });
  }
  draw();

  function openDrop() {
    const linked = new Set(linkedIds());
    const q = inp.value.trim().toLowerCase();
    const items = testList().filter(t => !linked.has(t.id) &&
      (!q || t.id.toLowerCase().includes(q) || (t.name || '').toLowerCase().includes(q))).slice(0, 8);
    drop.textContent = '';
    if (!items.length) { drop.hidden = true; return; }
    items.forEach(t => append(drop, elem('div', {
      class: 'cov-vtest-opt',
      onMousedown: async (e) => {
        e.preventDefault();
        drop.hidden = true; inp.value = ''; stEl.textContent = 'Linking…';
        const ok = await app.linkTestToRequirement(t.id, reqId);
        stEl.textContent = ok ? 'Linked ' + t.id : 'Link failed';
        if (ok) { draw(); cov.renderGraph(); }
      }
    }, elem('span', 'cov-vtest-optname', t.name || t.id), elem('span', 'cov-vtest-optid', t.id))));
    drop.hidden = false;
  }
  inp.addEventListener('input', openDrop);
  inp.addEventListener('focus', openDrop);
  inp.addEventListener('blur', () => setTimeout(() => { drop.hidden = true; }, 160));
  return sec;
}

/**
 * The automated tests for a requirement / test: any the xUnit self-declares
 * (read-only) plus ones the user has CONNECTED (with a ✕ to disconnect), a
 * search over every discovered xUnit test, and an "add xUnit URL" field.
 * @param {string} id
 * @param {CovContext} cov
 * @returns {HTMLElement}
 */
function buildAutomated(id, cov) {
  const results = cov.results();
  const h = elem('h3');
  const list = elem('div', 'cov-auto-list');
  const stEl = elem('span', 'cov-medit-status');
  const inp = elem('input', { class: 'cov-vtest-search', placeholder: 'Search automated tests to connect…' });
  const drop = elem('div', { class: 'cov-vtest-drop', hidden: true });
  const urlInp = elem('input', { class: 'cov-vtest-search', placeholder: 'Add an external xUnit URL…' });
  const urlBtn = elem('button', { type: 'button', class: 'blk-small', onClick: addUrl }, 'Add');
  const sec = elem('div', 'cov-report-sec cov-auto', h, list,
    elem('div', 'cov-vtest-add', inp, stEl), drop, elem('div', 'cov-auto-url', urlInp, urlBtn));

  const keyOf = (tc) => (tc.classname || '') + ' ' + (tc.name || '');
  const catStatus = (key) => { const e = (results.autoCatalog || []).find(c => c.key === key); return e ? (e.pass ? 'pass' : 'fail') : 'untested'; };
  const reload = async () => { cov.setResults(await loadResults(state.site && state.site.sources)); cov.renderGraph(); showReport(id, cov); };

  function draw() {
    const linked = (results.autoLinks && results.autoLinks[id]) || [];
    const connectedNames = new Set(linked.map(tc => tc.name));
    const declared = ((testsFor(id, results).auto) || []).filter(a => !connectedNames.has(a.name));
    h.textContent = 'Automated tests (' + (linked.length + declared.length) + ')';
    list.textContent = '';
    if (!linked.length && !declared.length) append(list, elem('p', 'cov-report-empty', 'No automated tests connected.'));
    linked.forEach(tc => {
      const info = elem('div', 'cov-vtest-open cov-auto-info',
        statusDot(catStatus(keyOf(tc))),
        elem('span', 'cov-vtest-name', tc.name),
        elem('span', 'cov-vtest-id', tc.classname || tc.suite || ''));
      const rm = elem('button', {
        type: 'button', class: 'cov-vtest-rm', title: 'Disconnect this automated test',
        onClick: async () => { rm.disabled = true; stEl.textContent = 'Disconnecting…'; const ok = await disconnectAutomated(id, tc, state.site && state.site.sources); if (ok) reload(); else rm.disabled = false; }
      }, closeIcon());
      append(list, elem('div', 'cov-vtest', info, rm));
    });
    declared.forEach(a => append(list, elem('div', 'cov-vtest cov-auto-declared',
      elem('div', 'cov-vtest-open cov-auto-info',
        elem('span', 'cov-vtest-dot tc-result-' + (a.pass ? 'pass' : 'fail'), a.pass ? checkIcon() : closeIcon()),
        elem('span', 'cov-vtest-name', a.name),
        elem('span', 'cov-vtest-id', 'declared')))));
  }
  draw();

  function openDrop() {
    const connected = new Set(((results.autoLinks && results.autoLinks[id]) || []).map(keyOf));
    const q = inp.value.trim().toLowerCase();
    const items = (results.autoCatalog || []).filter(c => !connected.has(c.key) &&
      (!q || (c.name || '').toLowerCase().includes(q) || (c.classname || '').toLowerCase().includes(q))).slice(0, 8);
    drop.textContent = '';
    if (!items.length) { drop.hidden = true; return; }
    items.forEach(c => append(drop, elem('div', {
      class: 'cov-vtest-opt',
      onMousedown: async (e) => { e.preventDefault(); drop.hidden = true; inp.value = ''; stEl.textContent = 'Connecting…'; const ok = await connectAutomated(id, c, state.site && state.site.sources); if (ok) reload(); }
    }, elem('span', 'cov-vtest-optname', c.name), elem('span', 'cov-vtest-optid', (c.classname || c.suite || '') + ' ', c.pass ? checkIcon() : closeIcon()))));
    drop.hidden = false;
  }
  inp.addEventListener('input', openDrop);
  inp.addEventListener('focus', openDrop);
  inp.addEventListener('blur', () => setTimeout(() => { drop.hidden = true; }, 160));

  async function addUrl() {
    const url = urlInp.value.trim(); if (!url) return;
    urlBtn.disabled = true; stEl.textContent = 'Fetching…';
    const cat = await fetchXUnitCatalog(url);
    urlBtn.disabled = false;
    if (!cat.length) { stEl.textContent = 'No xUnit tests found at that URL.'; return; }
    const map = new Map((results.autoCatalog || []).map(c => [c.key, c]));
    cat.forEach(c => map.set(c.key, c)); results.autoCatalog = [...map.values()];
    await rememberAutoUrl(url, id, state.site && state.site.sources);
    urlInp.value = ''; stEl.textContent = 'Added ' + cat.length + ' tests — search to connect.';
    inp.focus(); openDrop();
  }
  urlInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } });

  return sec;
}
