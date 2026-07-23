// coverage-view.js - the full-screen Test Coverage overlay: the requirement/test
// status graph, the status legend filter, the per-node report panel (steps, run
// info, verifying-test linking, automated-test connection) and the exportable HTML
// report. Extracted from main.js; cross-cutting handles (closing the other overlay,
// linking tests to requirements) come through the shared `app` registry.
import { state, el, downloadFile, isoDate, combinedStatus, app } from './app-shell.js';
import { requirementList, testList, setCoverageStatus, blockMarkdown } from './requirements.js';
import { loadResults, computeCoverage, computeTestStatus, testsFor, manualTests, connectAutomated, disconnectAutomated, rememberAutoUrl, fetchXUnitCatalog } from './coverage.js';
import { generateReportHtml } from './report.js';
import { sanitizeToFragment } from './sanitize.js';
import { createGraph } from './graph.js';

let covApi = null;
let covTransform = null;   // last pan/zoom of the coverage map, persisted across reopen + rebuilds
export function setupCoverageView() {
  const btn = el('covBtn');
  const overlay = document.createElement('div');
  overlay.className = 'graph-overlay cov-overlay';
  overlay.id = 'covOverlay';
  overlay.hidden = true;
  const stage = document.createElement('div');
  overlay.appendChild(stage);

  // Status legend, each entry a toggle that hides/shows nodes of that status
  // (and any edges that touch a hidden node), like the map's category legend.
  const statusOff = new Set();
  function applyStatusFilter() {
    const hidden = new Set();
    stage.querySelectorAll('.graph-node[data-node-id]').forEach(n => {
      const off = [...statusOff].some(s => n.classList.contains('graph-node-st-' + s));
      n.style.display = off ? 'none' : '';
      if (off) hidden.add(n.getAttribute('data-node-id'));
    });
    stage.querySelectorAll('.graph-edge').forEach(e => {
      const f = e.getAttribute('data-from'), t = e.getAttribute('data-to');
      e.style.display = (hidden.has(f) || hidden.has(t)) ? 'none' : '';
    });
  }
  const legend = document.createElement('div');
  legend.className = 'cov-legend';
  [['pass', 'Passing'], ['fail', 'Failing'], ['partial', 'Partial'], ['untested', 'Untested']].forEach(([k, l]) => {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'cov-legend-item';
    item.setAttribute('aria-pressed', 'true'); item.title = 'Toggle ' + l + ' requirements';
    const sw = document.createElement('span'); sw.className = 'cov-swatch cov-swatch-' + k;
    item.append(sw, document.createTextNode(l));
    item.addEventListener('click', () => {
      const off = !statusOff.has(k);
      if (off) statusOff.add(k); else statusOff.delete(k);
      item.classList.toggle('is-off', off);
      item.setAttribute('aria-pressed', off ? 'false' : 'true');
      applyStatusFilter();
    });
    legend.appendChild(item);
  });
  overlay.appendChild(legend);

  // Export a self-contained, shareable test report (downloads an .html file).
  const exportBtn = document.createElement('button');
  exportBtn.className = 'cov-export-btn'; exportBtn.type = 'button';
  exportBtn.textContent = '⤓ Export report';
  exportBtn.title = 'Download a self-contained test report (HTML) you can share anywhere';
  exportBtn.addEventListener('click', () => exportReport());
  overlay.appendChild(exportBtn);

  const panel = document.createElement('aside'); panel.className = 'cov-report'; panel.hidden = true;
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Left-edge grip to drag the report panel wider/narrower (persists per session).
  const resizeHandle = document.createElement('div'); resizeHandle.className = 'cov-report-resize'; resizeHandle.title = 'Drag to resize';
  resizeHandle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX, startW = panel.getBoundingClientRect().width;
    try { resizeHandle.setPointerCapture(e.pointerId); } catch (err) {}
    const move = (ev) => { panel.style.width = Math.min(window.innerWidth - 60, Math.max(320, startW + (startX - ev.clientX))) + 'px'; };
    const up = () => { resizeHandle.removeEventListener('pointermove', move); resizeHandle.removeEventListener('pointerup', up); };
    resizeHandle.addEventListener('pointermove', move);
    resizeHandle.addEventListener('pointerup', up);
  });

  let results = null;

  // Build (or REBUILD) the graph from the current index + results. Called on open
  // and again whenever a requirement<->test link changes, so the view (nodes AND
  // edges) reflects an add/remove immediately.
  const renderGraph = () => {
    const reqs = requirementList();
    if (!reqs.length) { if (covApi) { covApi.destroy(); covApi = null; } stage.innerHTML = '<p class="cov-empty">No requirements found to test.</p>'; return; }
    const tests = testList();
    const status = combinedStatus(reqs, tests, results);
    setCoverageStatus(status);   // keep in-document badges (requirement + test tables) in sync
    const parents = {}; reqs.forEach(r => (parents[r.id] = []));
    reqs.forEach(p => (p.traceFrom || []).forEach(c => { if (parents[c]) parents[c].push(p.id); }));
    const reqPseudo = reqs.map(r => ({ id: r.id, title: r.id, description: r.description, assumes: parents[r.id] || [], next: [] }));
    // Test cases are their own nodes, linked FROM each requirement they verify
    // (assumes = verifies -> a prereq edge requirement -> test).
    const testPseudo = tests.map(t => ({
      id: t.id, title: t.name || t.id,
      description: (t.steps || []).length + ' step' + ((t.steps || []).length === 1 ? '' : 's'),
      assumes: (t.verifies || []).slice(), next: []
    }));
    const nodeKind = new Map();
    reqs.forEach(r => nodeKind.set(r.id, 'req'));
    tests.forEach(t => nodeKind.set(t.id, 'test'));
    if (covApi) { covTransform = covApi.getTransform(); covApi.destroy(); }   // remember the live view before rebuild
    covApi = createGraph(stage, reqPseudo.concat(testPseudo), {
      nodeStatus: status, nodeKind: nodeKind, hideLegend: true,
      autoSize: true, maxNodeW: 360, maxNodeH: 240,   // size boxes to fit the largest node
      initialTransform: covTransform,                 // restore last pan/zoom (null on first open -> fit)
      onSelect: (id) => showReport(id),
      onActivate: (id) => showReport(id)
    });
    applyStatusFilter();   // keep any active legend filter across reopen/rebuild
  };

  const open = async () => {
    if (app.closeMapView) app.closeMapView();     // only one overlay view at a time
    overlay.hidden = false;
    btn.setAttribute('aria-pressed', 'true');
    panel.hidden = true;
    results = await loadResults(state.site && state.site.sources);
    renderGraph();
    el('live').textContent = 'Opened the test coverage view. Click a requirement for its test report.';
  };
  const close = () => {
    if (overlay.hidden) return;
    overlay.hidden = true;
    btn.setAttribute('aria-pressed', 'false');
    if (covApi) { covTransform = covApi.getTransform(); covApi.destroy(); covApi = null; }   // remember the view
  };

  // Test-case node clicked: show its definition (action/expected), the recorded
  // result (actual/pass) and run metadata, plus a "Run this test" button.
  function showTestReport(id) {
    const t = testList().find(x => x.id === id);
    const st = (computeTestStatus(t ? [t] : [], results).get(id)) || { status: 'untested' };
    const ex = manualTests(results.manual && results.manual[id]);
    const exSteps = ex.length ? (ex[0].steps || []) : [];
    const run = results.manual && results.manual[id] && results.manual[id].run;

    panel.hidden = false;
    panel.textContent = '';
    panel.appendChild(resizeHandle);

    const h = document.createElement('div'); h.className = 'cov-report-head';
    const title = document.createElement('h2'); title.textContent = t ? t.name : id;
    const x = document.createElement('button'); x.className = 'cov-report-close'; x.textContent = '✕'; x.title = 'Close';
    x.addEventListener('click', () => { panel.hidden = true; });
    h.append(title, x); panel.appendChild(h);

    const sub = document.createElement('p'); sub.className = 'cov-report-desc tc-report-sub';
    const idc = document.createElement('code'); idc.textContent = id; sub.append(idc, document.createTextNode(' '));
    const pill = document.createElement('span'); pill.className = 'tc-result tc-result-' + st.status;
    pill.textContent = st.status === 'pass' ? 'Pass' : st.status === 'fail' ? 'Fail' : st.status === 'partial' ? 'Partial' : 'Untested';
    sub.appendChild(pill); panel.appendChild(sub);

    if (t && t.verifies.length) {
      const v = document.createElement('p'); v.className = 'cov-report-link'; v.append(document.createTextNode('Verifies: '));
      t.verifies.forEach((rid, i) => {
        if (i) v.append(', ');
        const doc = (requirementList().find(r => r.id === rid) || {}).docId;
        const a = document.createElement('a'); a.href = '#/' + doc + '?req=' + rid; a.textContent = rid;
        a.addEventListener('click', () => close()); v.appendChild(a);
      });
      panel.appendChild(v);
    }
    if (t) { const a = document.createElement('a'); a.className = 'cov-report-link'; a.href = '#/' + t.docId + '?test=' + id; a.textContent = 'Open in its document ↗'; a.addEventListener('click', () => close()); panel.appendChild(a); }
    if (run) {
      const rn = document.createElement('p'); rn.className = 'cov-report-note';
      const when = run.at && !isNaN(new Date(run.at).getTime()) ? new Date(run.at).toLocaleString() : '';
      rn.textContent = 'Last run' + (run.by ? ' by ' + run.by : '') + (when ? ' · ' + when : '');
      panel.appendChild(rn);
    }

    const sec = document.createElement('div'); sec.className = 'cov-report-sec';
    const l = document.createElement('h3'); l.textContent = 'Steps (' + ((t && t.steps) || []).length + ')'; sec.appendChild(l);
    ((t && t.steps) || []).forEach((s, i) => {
      const ex2 = exSteps[i];
      const hasResult = ex2 && typeof ex2.pass === 'boolean';   // null = not recorded, don't paint it red
      const step = document.createElement('div'); step.className = 'tc-step' + (hasResult ? (ex2.pass ? ' is-pass' : ' is-fail') : '');
      const head = document.createElement('div'); head.className = 'tc-step-head';
      const n = document.createElement('span'); n.className = 'tc-step-n'; n.textContent = (i + 1) + '.';
      const act = document.createElement('div'); act.className = 'tc-step-act tc-md'; act.appendChild(blockMarkdown(s.action));
      head.append(n, act);
      if (ex2 && typeof ex2.pass === 'boolean') { const dot = document.createElement('span'); dot.className = 'tc-step-dot'; dot.textContent = ex2.pass ? '✓' : '✕'; head.appendChild(dot); }
      step.appendChild(head);
      const exp = document.createElement('div'); exp.className = 'tc-step-exp';
      const lbl = document.createElement('div'); lbl.className = 'tc-step-lbl'; lbl.textContent = 'Expected'; exp.appendChild(lbl);
      const eb = document.createElement('div'); eb.className = 'tc-md'; eb.appendChild(blockMarkdown(s.expected)); exp.appendChild(eb);
      step.appendChild(exp);
      if (ex2 && ex2.response) { const ac = document.createElement('div'); ac.className = 'tc-step-actual'; ac.append(document.createTextNode('Actual: ')); ac.appendChild(sanitizeToFragment(ex2.response)); step.appendChild(ac); }
      sec.appendChild(step);
    });
    panel.appendChild(sec);
    panel.appendChild(buildAutomated(id));   // connect an automated test as this test's automation

    const bar = document.createElement('div'); bar.className = 'cov-medit-bar';
    const runBtn = document.createElement('button'); runBtn.type = 'button'; runBtn.className = 'btn btn-primary'; runBtn.textContent = '▷ Run this test';
    runBtn.addEventListener('click', () => document.dispatchEvent(new CustomEvent('webdoc:run-test', { detail: { testId: id } })));
    bar.appendChild(runBtn); panel.appendChild(bar);
  }

  function showReport(id) {
    if (id && id.indexOf('T_') === 0) return showTestReport(id);
    const req = requirementList().find(r => r.id === id);
    panel.hidden = false;
    panel.textContent = '';
    panel.appendChild(resizeHandle);   // re-attach the grip (textContent clear removed it)
    const h = document.createElement('div'); h.className = 'cov-report-head';
    const title = document.createElement('h2'); title.textContent = id;
    const x = document.createElement('button'); x.className = 'cov-report-close'; x.textContent = '✕'; x.title = 'Close';
    x.addEventListener('click', () => { panel.hidden = true; });
    h.append(title, x); panel.appendChild(h);
    if (req && req.description) { const d = document.createElement('p'); d.className = 'cov-report-desc'; d.textContent = req.description; panel.appendChild(d); }
    if (req) { const a = document.createElement('a'); a.className = 'cov-report-link'; a.href = '#/' + req.docId + '?req=' + id; a.textContent = 'Open in its document ↗'; a.addEventListener('click', () => close()); panel.appendChild(a); }
    panel.appendChild(buildAutomated(id));
    panel.appendChild(buildVerifyingTests(id));
  }

  // Editable manual tests for a requirement. A requirement can hold SEVERAL named
  // manual tests, each with its own pass/fail steps (a rich-text step + response)
  // plus notes. All text fields are WYSIWYG; their HTML is sanitised on save.
  // The test cases that verify this requirement (its calculated Verified By):
  // read-only + clickable, plus a search box to LINK an existing test case
  // (which adds this requirement to that test's `verifies` in the test's doc).
  // Test cases are authored in documents / the editor, never here.
  function buildVerifyingTests(reqId) {
    const sec = document.createElement('div'); sec.className = 'cov-report-sec cov-vtests';
    const h = document.createElement('h3'); sec.appendChild(h);
    const list = document.createElement('div'); list.className = 'cov-vtest-list'; sec.appendChild(list);
    const tstatus = computeTestStatus(testList(), results);
    const statusOf = (tid) => (tstatus.get(tid) || {}).status || 'untested';

    function linkedIds() { return ((requirementList().find(r => r.id === reqId) || {}).verifiedBy) || []; }
    function draw() {
      const linked = linkedIds();
      h.textContent = 'Test cases (' + linked.length + ')';
      list.textContent = '';
      if (!linked.length) { const e = document.createElement('p'); e.className = 'cov-report-empty'; e.textContent = 'No test cases verify this requirement yet.'; list.appendChild(e); }
      linked.forEach(tid => {
        const t = testList().find(x => x.id === tid);
        const row = document.createElement('div'); row.className = 'cov-vtest';
        const openBtn = document.createElement('button'); openBtn.type = 'button'; openBtn.className = 'cov-vtest-open'; openBtn.title = 'Open ' + tid;
        const st = statusOf(tid);
        const dot = document.createElement('span'); dot.className = 'cov-vtest-dot tc-result-' + st; dot.textContent = st === 'pass' ? '✓' : st === 'fail' ? '✕' : '○';
        const nm = document.createElement('span'); nm.className = 'cov-vtest-name'; nm.textContent = t ? t.name : tid;
        const idb = document.createElement('span'); idb.className = 'cov-vtest-id'; idb.textContent = tid;
        openBtn.append(dot, nm, idb);
        openBtn.addEventListener('click', () => showReport(tid));
        const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'cov-vtest-rm'; rm.textContent = '✕'; rm.title = 'Unlink this test from the requirement';
        rm.addEventListener('click', async () => {
          rm.disabled = true; stEl.textContent = 'Unlinking…';
          const ok = await app.unlinkTestFromRequirement(tid, reqId);
          stEl.textContent = ok ? 'Unlinked ' + tid : 'Unlink failed';
          if (ok) { draw(); renderGraph(); } else rm.disabled = false;
        });
        row.append(openBtn, rm);
        list.appendChild(row);
      });
    }
    draw();

    const addWrap = document.createElement('div'); addWrap.className = 'cov-vtest-add';
    const inp = document.createElement('input'); inp.className = 'cov-vtest-search'; inp.placeholder = 'Search to link an existing test…';
    const stEl = document.createElement('span'); stEl.className = 'cov-medit-status';
    const drop = document.createElement('div'); drop.className = 'cov-vtest-drop'; drop.hidden = true;
    addWrap.append(inp, stEl); sec.append(addWrap, drop);

    function openDrop() {
      const linked = new Set(linkedIds());
      const q = inp.value.trim().toLowerCase();
      const items = testList().filter(t => !linked.has(t.id) &&
        (!q || t.id.toLowerCase().includes(q) || (t.name || '').toLowerCase().includes(q))).slice(0, 8);
      drop.textContent = '';
      if (!items.length) { drop.hidden = true; return; }
      items.forEach(t => {
        const o = document.createElement('div'); o.className = 'cov-vtest-opt';
        const nm = document.createElement('span'); nm.className = 'cov-vtest-optname'; nm.textContent = t.name || t.id;
        const idb = document.createElement('span'); idb.className = 'cov-vtest-optid'; idb.textContent = t.id;
        o.append(nm, idb);
        o.addEventListener('mousedown', async (e) => {
          e.preventDefault();
          drop.hidden = true; inp.value = ''; stEl.textContent = 'Linking…';
          const ok = await app.linkTestToRequirement(t.id, reqId);
          stEl.textContent = ok ? 'Linked ' + t.id : 'Link failed';
          if (ok) { draw(); renderGraph(); }
        });
        drop.appendChild(o);
      });
      drop.hidden = false;
    }
    inp.addEventListener('input', openDrop);
    inp.addEventListener('focus', openDrop);
    inp.addEventListener('blur', () => setTimeout(() => { drop.hidden = true; }, 160));
    return sec;
  }

  // The automated tests for a requirement / test: any the xUnit self-declares
  // (read-only) plus ones the user has CONNECTED (with a ✕ to disconnect), a
  // search over every discovered xUnit test, and an "add xUnit URL" field.
  function buildAutomated(id) {
    const sec = document.createElement('div'); sec.className = 'cov-report-sec cov-auto';
    const h = document.createElement('h3'); sec.appendChild(h);
    const list = document.createElement('div'); list.className = 'cov-auto-list'; sec.appendChild(list);
    const stEl = document.createElement('span'); stEl.className = 'cov-medit-status';
    const keyOf = (tc) => (tc.classname || '') + ' ' + (tc.name || '');
    const catStatus = (key) => { const e = (results.autoCatalog || []).find(c => c.key === key); return e ? (e.pass ? 'pass' : 'fail') : 'untested'; };
    const reload = async () => { results = await loadResults(state.site && state.site.sources); renderGraph(); showReport(id); };

    function draw() {
      const linked = (results.autoLinks && results.autoLinks[id]) || [];
      const connectedNames = new Set(linked.map(tc => tc.name));
      const declared = ((testsFor(id, results).auto) || []).filter(a => !connectedNames.has(a.name));
      h.textContent = 'Automated tests (' + (linked.length + declared.length) + ')';
      list.textContent = '';
      if (!linked.length && !declared.length) { const e = document.createElement('p'); e.className = 'cov-report-empty'; e.textContent = 'No automated tests connected.'; list.appendChild(e); }
      linked.forEach(tc => {
        const st = catStatus(keyOf(tc));
        const row = document.createElement('div'); row.className = 'cov-vtest';
        const info = document.createElement('div'); info.className = 'cov-vtest-open cov-auto-info';
        const dot = document.createElement('span'); dot.className = 'cov-vtest-dot tc-result-' + st; dot.textContent = st === 'pass' ? '✓' : st === 'fail' ? '✕' : '○';
        const nm = document.createElement('span'); nm.className = 'cov-vtest-name'; nm.textContent = tc.name;
        const cl = document.createElement('span'); cl.className = 'cov-vtest-id'; cl.textContent = tc.classname || tc.suite || '';
        info.append(dot, nm, cl);
        const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'cov-vtest-rm'; rm.textContent = '✕'; rm.title = 'Disconnect this automated test';
        rm.addEventListener('click', async () => { rm.disabled = true; stEl.textContent = 'Disconnecting…'; const ok = await disconnectAutomated(id, tc, state.site && state.site.sources); if (ok) reload(); else rm.disabled = false; });
        row.append(info, rm); list.appendChild(row);
      });
      declared.forEach(a => {
        const row = document.createElement('div'); row.className = 'cov-vtest cov-auto-declared';
        const info = document.createElement('div'); info.className = 'cov-vtest-open cov-auto-info';
        const dot = document.createElement('span'); dot.className = 'cov-vtest-dot tc-result-' + (a.pass ? 'pass' : 'fail'); dot.textContent = a.pass ? '✓' : '✕';
        const nm = document.createElement('span'); nm.className = 'cov-vtest-name'; nm.textContent = a.name;
        const tag = document.createElement('span'); tag.className = 'cov-vtest-id'; tag.textContent = 'declared';
        info.append(dot, nm, tag); row.appendChild(info); list.appendChild(row);
      });
    }
    draw();

    const addWrap = document.createElement('div'); addWrap.className = 'cov-vtest-add';
    const inp = document.createElement('input'); inp.className = 'cov-vtest-search'; inp.placeholder = 'Search automated tests to connect…';
    const drop = document.createElement('div'); drop.className = 'cov-vtest-drop'; drop.hidden = true;
    addWrap.append(inp, stEl); sec.append(addWrap, drop);
    function openDrop() {
      const connected = new Set(((results.autoLinks && results.autoLinks[id]) || []).map(keyOf));
      const q = inp.value.trim().toLowerCase();
      const items = (results.autoCatalog || []).filter(c => !connected.has(c.key) &&
        (!q || (c.name || '').toLowerCase().includes(q) || (c.classname || '').toLowerCase().includes(q))).slice(0, 8);
      drop.textContent = '';
      if (!items.length) { drop.hidden = true; return; }
      items.forEach(c => {
        const o = document.createElement('div'); o.className = 'cov-vtest-opt';
        const nm = document.createElement('span'); nm.className = 'cov-vtest-optname'; nm.textContent = c.name;
        const idb = document.createElement('span'); idb.className = 'cov-vtest-optid'; idb.textContent = (c.classname || c.suite || '') + ' ' + (c.pass ? '✓' : '✕');
        o.append(nm, idb);
        o.addEventListener('mousedown', async (e) => { e.preventDefault(); drop.hidden = true; inp.value = ''; stEl.textContent = 'Connecting…'; const ok = await connectAutomated(id, c, state.site && state.site.sources); if (ok) reload(); });
        drop.appendChild(o);
      });
      drop.hidden = false;
    }
    inp.addEventListener('input', openDrop);
    inp.addEventListener('focus', openDrop);
    inp.addEventListener('blur', () => setTimeout(() => { drop.hidden = true; }, 160));

    const urlWrap = document.createElement('div'); urlWrap.className = 'cov-auto-url';
    const urlInp = document.createElement('input'); urlInp.className = 'cov-vtest-search'; urlInp.placeholder = 'Add an external xUnit URL…';
    const urlBtn = document.createElement('button'); urlBtn.type = 'button'; urlBtn.className = 'blk-small'; urlBtn.textContent = 'Add';
    urlWrap.append(urlInp, urlBtn); sec.appendChild(urlWrap);
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
    urlBtn.addEventListener('click', addUrl);
    urlInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } });

    return sec;
  }

  // Build and download a self-contained, shareable Test Coverage Report.
  async function exportReport() {
    const res = results || await loadResults(state.site && state.site.sources);
    const reqs = requirementList();
    const tests = testList();
    const now = new Date();
    const html = generateReportHtml({
      title: (state.site && state.site.siteTitle) || 'WebDocs',
      generatedAt: now.toLocaleString(),
      requirements: reqs,
      tests: tests,
      reqStatus: computeCoverage(reqs, res),
      testStatus: computeTestStatus(tests, res),
      detail: tests.map(t => {
        const d = Object.assign({ id: t.id }, testsFor(t.id, res));
        const m = res.manual[t.id];
        d.run = (m && m.run) ? m.run : null;   // run metadata (when / who)
        return d;
      })
    });
    const base = ((state.site && state.site.siteTitle) || 'webdocs').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'webdocs';
    downloadFile(base + '-test-report-' + isoDate(now) + '.html', html, 'text/html');
    el('live').textContent = 'Test report downloaded.';
  }

  // Recompute status and repaint node colours in place (keeps pan/zoom).
  function recolor() {
    const status = combinedStatus(requirementList(), testList(), results);
    setCoverageStatus(status); // keep the in-document table badges (requirement + test) in sync too
    overlay.querySelectorAll('.graph-node[data-node-id]').forEach(node => {
      const nid = node.getAttribute('data-node-id');
      const s = status.get(nid);
      [...node.classList].filter(c => c.indexOf('graph-node-st-') === 0).forEach(c => node.classList.remove(c));
      if (s) node.classList.add('graph-node-st-' + s.status);
      const cov = node.querySelector('.graph-node-cov');
      if (cov && s) {
        const isTest = node.classList.contains('graph-node-kind-test');
        cov.textContent = isTest
          ? (s.status === 'pass' ? 'Pass' : s.status === 'fail' ? 'Fail' : s.status === 'partial' ? 'Partial' : 'Untested')
          : ((s.pct === null || s.pct === undefined) ? 'untested' : (s.pct + '% passing'));
      }
    });
    applyStatusFilter();   // a node's status may have changed; re-apply the legend filter
  }

  app.closeCoverageView = close;
  btn.addEventListener('click', () => (overlay.hidden ? open() : close()));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) { if (!panel.hidden) panel.hidden = true; else close(); } });
}
