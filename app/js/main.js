// main.js - application entry point. Wires the shell together:
// theme, discovery, hash routing, the render pipeline, the drawer and search.
import { loadSite, discover, loadDoc } from './catalog.js';
import { renderMarkdown, INTERIM } from './commonmark.js';
import { sanitizeToFragment } from './sanitize.js';
import { numberHeadings, buildTOC } from './numbering.js';
import { renderTree, markActive } from './tree.js';
import { buildSearchIndex, searchDocs } from './search.js';
import { createGraph } from './graph.js';
import { openEditor, openNewDocModal, parseDoc, setLinkDocs, richText } from './editor.js';
import { loadResults, computeCoverage, computeTestStatus, testsFor, saveManual, manualTests, connectAutomated, disconnectAutomated, rememberAutoUrl, fetchXUnitCatalog } from './coverage.js';
import { generateReportHtml } from './report.js';
import { openRunner } from './runner.js';
import { documentLinks } from './doclinks.js';
import { highlightWithin } from './highlighter.js';
import { renderBlocks } from './blocks.js';
import { loadPlugins } from './plugins.js';
import { buildRequirementIndex, preprocessRequirements, renderRequirements, revealRequirement, revealTest, reqFromQuery, testFromQuery, requirementTraceEdges, requirementList, testList, setCoverageStatus, inlineMarkdown, blockMarkdown, resolveRequirementRef } from './requirements.js';

// Combined status map: requirement rollups (which now include their Verified By
// tests) plus each test case's own pass/fail. Keys never collide (T namespace).
function combinedStatus(reqs, tests, results) {
  const m = computeCoverage(reqs, results);
  computeTestStatus(tests, results).forEach((v, k) => m.set(k, v));
  return m;
}
// Download a string as a file (self-contained report), no server round-trip.
function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

const el = id => document.getElementById(id);
const state = { site: null, docs: [], byId: new Map(), current: null, spy: null };

// ---- Theme ----------------------------------------------------------------
function setupTheme() {
  const btn = el('themeBtn'), root = document.documentElement;
  const sync = () => {
    const dark = root.getAttribute('data-theme') === 'dark';
    btn.setAttribute('aria-pressed', String(dark));
    btn.textContent = dark ? '☀' : '☾';
  };
  btn.addEventListener('click', () => {
    const dark = root.getAttribute('data-theme') === 'dark';
    const next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('wd-theme', next); } catch (e) {}
    sync();
  });
  sync();
}

// ---- Drawer ---------------------------------------------------------------
function setupDrawer() {
  const drawer = el('doc-tree'), scrim = el('scrim'), btn = el('hamburger');
  let lastFocus = null;
  const open = () => {
    lastFocus = document.activeElement;
    drawer.hidden = false; scrim.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.documentElement.style.overflow = 'hidden';
    (drawer.querySelector('#treeSearch') || drawer).focus();
  };
  const close = () => {
    drawer.hidden = true; scrim.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.documentElement.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  };
  btn.addEventListener('click', () => (drawer.hidden ? open() : close()));
  el('drawerClose').addEventListener('click', close);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) close(); });
  return { open, close };
}

// ---- All-documents search (titles + headings) in the drawer ---------------
function setupDrawerSearch(drawer) {
  const input = el('treeSearch');
  const results = el('searchResults');
  const tree = el('treeList');
  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (!q) { results.hidden = true; results.textContent = ''; tree.hidden = false; return; }
    tree.hidden = true;
    results.hidden = false;
    results.textContent = '';
    const hits = searchDocs(q, 50);
    if (!hits.length) {
      const p = document.createElement('p');
      p.className = 'search-empty';
      p.textContent = 'No documents match “' + q + '”.';
      results.appendChild(p);
      return;
    }
    for (const hit of hits) {
      const a = document.createElement('a');
      a.className = 'search-hit';
      a.href = '#/' + hit.docId;
      const t = document.createElement('span');
      t.className = 'search-hit-title';
      t.textContent = hit.title;
      a.appendChild(t);
      if (hit.headings.length) {
        const sub = document.createElement('span');
        sub.className = 'search-hit-sub';
        sub.textContent = hit.headings.slice(0, 3).join(' · ');
        a.appendChild(sub);
      }
      a.addEventListener('click', ev => {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
        ev.preventDefault();
        navigate(hit.docId);
        drawer.close();
      });
      results.appendChild(a);
    }
  });
}

// ---- Rendering pipeline ---------------------------------------------------
function renderDoc(doc) {
  const content = el('content');
  content.textContent = '';

  if (INTERIM) {
    const banner = document.createElement('div');
    banner.className = 'interim-banner';
    banner.innerHTML = '<strong>Interim renderer.</strong> Layout preview only — the full, ' +
      'CommonMark-compliant engine (verified against spec.json) is the next phase and will ' +
      'replace this without changing anything else.';
    content.appendChild(banner);
  }

  const article = document.createElement('article');
  article.className = 'doc';

  // pipeline: extract requirement groups -> parse -> sanitize (inert) -> adopt
  const html = renderMarkdown(preprocessRequirements(doc.body || '', doc.id));
  article.appendChild(sanitizeToFragment(html));
  content.appendChild(article);

  // Surface the metadata description as a subtitle under the first heading.
  if (doc.description) {
    const lede = document.createElement('p');
    lede.className = 'doc-lede';
    lede.textContent = doc.description;
    const h1 = article.querySelector('h1');
    if (h1) h1.after(lede); else article.prepend(lede);
  }

  const toc = numberHeadings(article);
  const tocList = el('tocList');
  tocList.textContent = '';
  tocList.appendChild(buildTOC(toc, content));

  // Requirement-group tables: post-sanitize, replace the reqgroup placeholders.
  renderRequirements(article, doc.id);

  // Resolve in-body links: internal doc-id refs -> hash routes, in-page anchors
  // -> smooth scroll, external URLs -> open in a new tab. (Heading ids exist now.)
  resolveLinks(article);

  // Pluggable rendered blocks (diagrams etc.): post-sanitize, before the
  // highlighter, so a registered ```lang block becomes DOM instead of code.
  // No-op unless a renderer plugin is enabled; runs before links inside a
  // rendered diagram would be reprocessed.
  renderBlocks(article, { docId: doc.id });

  // Syntax highlighting: post-sanitize, over the remaining code blocks.
  highlightWithin(article);

  setupScrollSpy(article, tocList);

  // header + footer chrome
  document.title = doc.title + ' — ' + (state.site.siteTitle || 'Documentation');
  el('crumbs').textContent = doc.id.split('/').join(' › ');
  renderFooter(doc);
  markActive(el('treeList'), doc.id);

  content.scrollTop = 0;
  content.focus({ preventScroll: true });
  el('live').textContent = 'Loaded: ' + doc.title;
}

// A written Markdown link like [x](Docs/features/map) has no scheme, so the
// browser would resolve it against the server path and 404. Rewrite in-body
// links after render: doc-id refs become #/ routes, in-page anchors scroll
// smoothly (without clobbering the router hash), and real URLs open externally.
function cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/([^\w-])/g, '\\$1'); }
function resolveDocId(path) {
  if (!path) return null;
  if (state.byId.has(path)) return path;
  const lower = path.toLowerCase();
  for (const id of state.byId.keys()) if (id.toLowerCase() === lower) return id;         // case-insensitive
  for (const id of state.byId.keys()) {                                                    // path with the source segment omitted
    const i = id.indexOf('/');
    if (i >= 0 && id.slice(i + 1).toLowerCase() === lower) return id;
  }
  return null;
}
function resolveLinks(article) {
  article.querySelectorAll('a[href]').forEach(a => {
    const raw = a.getAttribute('href') || '';
    if (!raw) return;
    if (/^(https?:|mailto:|tel:)/i.test(raw)) {                 // external
      a.setAttribute('target', '_blank');
      const rel = new Set((a.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
      rel.add('noopener'); rel.add('noreferrer');
      a.setAttribute('rel', [...rel].join(' '));
      a.setAttribute('data-external', '');
      return;
    }
    if (raw.startsWith('#/')) return;                           // already an app route
    if (raw.startsWith('#')) {                                  // in-page anchor
      const id = decodeURIComponent(raw.slice(1));
      a.addEventListener('click', ev => {
        const target = article.querySelector('#' + cssEsc(id));
        if (target) { ev.preventDefault(); target.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      });
      return;
    }
    const hashIdx = raw.indexOf('#');                           // internal document reference
    const path = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw).replace(/^\.?\//, '').replace(/\.md$/i, '').replace(/\/+$/, '');
    const frag = hashIdx >= 0 ? raw.slice(hashIdx + 1) : '';
    const id = resolveDocId(path);
    if (id) {
      a.setAttribute('href', '#/' + id);
      if (frag) a.addEventListener('click', () => setTimeout(() => {
        const t = el('content').querySelector('#' + cssEsc(decodeURIComponent(frag)));
        if (t) t.scrollIntoView({ block: 'start' });
      }, 140));
    } else {
      a.classList.add('doc-link-broken');
      a.title = 'Unresolved link: ' + raw;
      a.addEventListener('click', ev => ev.preventDefault());
    }
  });
}

// Sanitise a WYSIWYG field's HTML before storing it (manual-test fields), and a
// blank-check that ignores empty markup but treats an image as content.
function cleanHtml(html) {
  const d = document.createElement('div');
  d.appendChild(sanitizeToFragment(String(html || '')));
  return d.innerHTML.trim();
}
function htmlBlank(html) {
  const d = document.createElement('div'); d.innerHTML = html || '';
  return !d.textContent.trim() && !d.querySelector('img');
}

// Footer shows the current document's OWN metadata: every "assumed knowledge"
// entry (read first) and every "recommended next" entry - each may be several.
function renderFooter(doc) {
  buildFootGroup(el('footPrev'), doc.assumes || [], '‹ Assumed knowledge', false);
  buildFootGroup(el('footNext'), doc.next || [], 'Recommended next ›', true);
}
function buildFootGroup(container, ids, caption, isNext) {
  container.textContent = '';
  if (!ids || !ids.length) { container.hidden = true; return; }
  container.hidden = false;

  const cap = document.createElement('span');
  cap.className = 'foot-cap';
  cap.textContent = caption;
  container.appendChild(cap);

  const ul = document.createElement('ul');
  ul.className = 'foot-links';
  for (const id of ids) {
    const li = document.createElement('li');
    const target = state.byId.get(id);
    if (target) {
      const a = document.createElement('a');
      a.href = '#/' + id;
      a.textContent = target.title || id;
      li.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.className = 'foot-missing';
      span.title = 'Referenced document not found: ' + id;
      span.textContent = '⚠ ' + id;
      li.appendChild(span);
    }
    ul.appendChild(li);
  }
  container.appendChild(ul);
}

let spyObserver = null;
function setupScrollSpy(article, tocList) {
  if (spyObserver) spyObserver.disconnect();
  const links = new Map();
  tocList.querySelectorAll('a[data-target]').forEach(a => links.set(a.dataset.target, a));
  spyObserver = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) {
        tocList.querySelectorAll('a.active').forEach(a => a.classList.remove('active'));
        const a = links.get(e.target.id);
        if (a) a.classList.add('active');
      }
    }
  }, { root: el('content'), rootMargin: '-8% 0px -80% 0px', threshold: 0 });
  article.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => spyObserver.observe(h));
}

// ---- In-document search (highlight + jump) --------------------------------
function setupDocSearch() {
  const input = el('docSearch');
  input.addEventListener('input', () => {
    const article = el('content').querySelector('.doc');
    if (!article) return;
    clearHighlights(article);
    const q = input.value.trim();
    if (q.length < 2) return;
    const first = highlight(article, q);
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}
function clearHighlights(root) {
  root.querySelectorAll('mark.find').forEach(m => {
    const t = document.createTextNode(m.textContent);
    m.replaceWith(t);
  });
  root.normalize();
}
function highlight(root, q) {
  const needle = q.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement.closest('pre,code,mark') ? NodeFilter.FILTER_REJECT
                                                              : NodeFilter.FILTER_ACCEPT)
  });
  const targets = [];
  let node;
  while ((node = walker.nextNode())) if (node.nodeValue.toLowerCase().includes(needle)) targets.push(node);
  let firstMark = null;
  for (const text of targets) {
    const frag = document.createDocumentFragment();
    let s = text.nodeValue, lower = s.toLowerCase(), i = 0, idx;
    while ((idx = lower.indexOf(needle, i)) !== -1) {
      if (idx > i) frag.appendChild(document.createTextNode(s.slice(i, idx)));
      const mark = document.createElement('mark');
      mark.className = 'find';
      mark.textContent = s.slice(idx, idx + needle.length);
      frag.appendChild(mark);
      if (!firstMark) firstMark = mark;
      i = idx + needle.length;
    }
    if (i < s.length) frag.appendChild(document.createTextNode(s.slice(i)));
    text.replaceWith(frag);
  }
  return firstMark;
}

// The map and coverage views are both full-screen overlays; only one at a time.
let closeMapView = null, closeCoverageView = null;

// ---- Map (document-relationship graph) ------------------------------------
let graphApi = null;
function setupGraphButton() {
  const btn = el('graphBtn');
  const overlay = document.createElement('div');
  overlay.className = 'graph-overlay';
  overlay.id = 'graphOverlay';
  overlay.hidden = true;
  const stage = document.createElement('div'); // becomes .graph-root, fills overlay
  overlay.appendChild(stage);
  document.body.appendChild(overlay);

  const open = () => {
    if (closeCoverageView) closeCoverageView();   // only one overlay view at a time
    overlay.hidden = false;
    btn.setAttribute('aria-pressed', 'true');
    if (graphApi) graphApi.destroy();
    const traces = requirementTraceEdges();
    const links = documentLinks(state.docs, traces);
    graphApi = createGraph(stage, state.docs, {
      currentId: state.current && state.current.id,
      traceEdges: traces,
      pageLinks: links.pageLinks,
      externalNodes: links.externalNodes,
      onSelect: (id) => { navigate(id); },            // click: select it, stay on the map
      onActivate: (id) => { close(); navigate(id); }  // double-click: open the doc and leave
    });
    el('live').textContent = 'Opened the document map. Click a document to select it; double-click to open it. Escape closes.';
  };
  const close = () => {
    if (overlay.hidden) return;
    overlay.hidden = true;
    btn.setAttribute('aria-pressed', 'false');
    if (graphApi) { graphApi.destroy(); graphApi = null; }
    el('content').focus({ preventScroll: true });
  };

  closeMapView = close;
  btn.addEventListener('click', () => (overlay.hidden ? open() : close()));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });
}

// ---- Test coverage view ---------------------------------------------------
let covApi = null;
function setupCoverageButton() {
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
    if (covApi) covApi.destroy();
    covApi = createGraph(stage, reqPseudo.concat(testPseudo), {
      nodeStatus: status, nodeKind: nodeKind, hideLegend: true,
      autoSize: true, maxNodeW: 360, maxNodeH: 240,   // size boxes to fit the largest node
      onSelect: (id) => showReport(id),
      onActivate: (id) => showReport(id)
    });
    applyStatusFilter();   // keep any active legend filter across reopen/rebuild
  };

  const open = async () => {
    if (closeMapView) closeMapView();             // only one overlay view at a time
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
    if (covApi) { covApi.destroy(); covApi = null; }
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
          const ok = await unlinkTestFromRequirement(tid, reqId);
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
          const ok = await linkTestToRequirement(t.id, reqId);
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

  closeCoverageView = close;
  btn.addEventListener('click', () => (overlay.hidden ? open() : close()));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) { if (!panel.hidden) panel.hidden = true; else close(); } });
}

// ---- Editor (WYSIWYG authoring) -------------------------------------------
let appDrawer = null;
let editorEl = null;

function setupEditButtons() {
  el('newDocBtn').addEventListener('click', () => {
    openNewDocModal({
      sources: (state.site && state.site.sources) || [],
      exists: (id) => state.byId.has(id),
      onCreate: (id) => startNewDoc(id)
    });
  });
  el('editBtn').addEventListener('click', () => { if (state.current) editExisting(state.current); });
}

function startNewDoc(id) {
  const title = id.split('/').pop().replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  enterEdit(id, { title, description: '', assumes: [], next: [] },
    [{ type: 'heading', level: 1, html: title }, { type: 'paragraph', html: '' }], true);
}

async function editExisting(doc) {
  await loadDoc(doc);
  const parsed = parseDoc(doc.body || '', doc.meta || {});
  parsed.meta.title = doc.title || parsed.meta.title;
  parsed.meta.description = doc.description || parsed.meta.description;
  parsed.meta.assumes = (doc.assumes || []).slice();
  parsed.meta.next = (doc.next || []).slice();
  enterEdit(doc.id, parsed.meta, parsed.blocks, false);
}

function enterEdit(id, meta, blocks, isNew) {
  exitEdit();
  document.body.classList.add('is-editing');
  editorEl = openEditor({
    docId: id, meta, blocks, isNew,
    sources: (state.site && state.site.sources) || [],
    allDocs: state.docs,
    requirements: requirementList(),
    component: componentFor(id),
    onSave: (md, newMeta, status) => saveDoc(id, md, isNew, status),
    onClose: () => { exitEdit(); navigate(state.byId.has(id) ? id : defaultId()); }
  });
  document.querySelector('.app-body').appendChild(editorEl);
}
function exitEdit() {
  document.body.classList.remove('is-editing');
  if (editorEl) { editorEl.remove(); editorEl = null; }
}
function componentFor(id) {
  const src = id.split('/')[0];
  const s = ((state.site && state.site.sources) || []).find(x => x.name === src);
  return s ? s.component : '';
}

async function saveDoc(id, md, wasNew, status) {
  const slash = id.indexOf('/');
  const source = id.slice(0, slash), rel = id.slice(slash + 1) + '.md';
  let res;
  try {
    res = await fetch('/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/'),
      { method: 'PUT', body: md });
  } catch (e) { status.textContent = 'Save failed: ' + e.message; return; }
  if (!res.ok) { status.textContent = 'Save failed (' + res.status + ')'; return; }
  status.textContent = 'Saved.';
  await refreshCatalog();
  exitEdit();
  navigate(id);
}

async function refreshCatalog() {
  state.docs = await discover(state.site.sources || []);
  state.byId = new Map();
  await Promise.all(state.docs.map(d => loadDoc(d).catch(() => d)));
  state.docs.forEach(d => state.byId.set(d.id, d));
  await buildRequirementIndex(state.docs, state.site.sources);
  buildSearchIndex(state.docs);
  renderTree(el('treeList'), state.docs, (docId) => { navigate(docId); if (appDrawer) appDrawer.close(); });
}

// Link / unlink a test case and a requirement by editing the requirement id in
// that test's `verifies` (in the test's own document), then rebuilding the index.
function addVerifyToBody(body, testKey, reqId) {
  return String(body).replace(/<!--\s*meta\s+start\s*(\{[\s\S]*?\})\s*-->/gi, (m, json) => {
    let meta; try { meta = JSON.parse(json); } catch (e) { return m; }
    if ((meta.test || meta['test-case']) !== testKey) return m;
    const v = Array.isArray(meta.verifies) ? meta.verifies.map(String) : [];
    if (v.indexOf(reqId) !== -1) return m;                 // already linked
    v.push(reqId); meta.verifies = v;
    return '<!--meta start ' + JSON.stringify(meta) + '-->';
  });
}
function removeVerifyFromBody(body, testKey, reqId, component) {
  return String(body).replace(/<!--\s*meta\s+start\s*(\{[\s\S]*?\})\s*-->/gi, (m, json) => {
    let meta; try { meta = JSON.parse(json); } catch (e) { return m; }
    if ((meta.test || meta['test-case']) !== testKey) return m;
    const v = Array.isArray(meta.verifies) ? meta.verifies.map(String) : [];
    // drop any ref that IS or RESOLVES to reqId (verifies may hold short forms).
    const kept = v.filter(ref => ref !== reqId && resolveRequirementRef(ref, component) !== reqId);
    if (kept.length === v.length) return m;                // wasn't linked
    meta.verifies = kept;
    return '<!--meta start ' + JSON.stringify(meta) + '-->';
  });
}
async function writeTestDocBody(t, newBody, oldBody) {
  if (newBody === oldBody) return true;                    // no change
  const slash = t.docId.indexOf('/');
  const source = t.docId.slice(0, slash), rel = t.docId.slice(slash + 1) + '.md';
  let res;
  try {
    res = await fetch('/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/'),
      { method: 'PUT', body: newBody });
  } catch (e) { return false; }
  if (!res.ok) return false;
  await refreshCatalog();
  return true;
}
async function linkTestToRequirement(testId, reqId) {
  const t = testList().find(x => x.id === testId);
  if (!t) return false;
  const doc = state.byId.get(t.docId); if (!doc) return false;
  try { await loadDoc(doc); } catch (e) {}
  const body = doc.body || '';
  return writeTestDocBody(t, addVerifyToBody(body, t.key, reqId), body);
}
async function unlinkTestFromRequirement(testId, reqId) {
  const t = testList().find(x => x.id === testId);
  if (!t) return false;
  const doc = state.byId.get(t.docId); if (!doc) return false;
  try { await loadDoc(doc); } catch (e) {}
  const body = doc.body || '';
  return writeTestDocBody(t, removeVerifyFromBody(body, t.key, reqId, t.component), body);
}

// ---- Routing --------------------------------------------------------------
async function route() {
  const hash = location.hash || '';
  if (!hash.startsWith('#/')) return; // ignore in-page anchors etc.
  const raw = hash.slice(2);
  const q = raw.indexOf('?');                      // split off ?req=<ID>
  const id = decodeURIComponent(q === -1 ? raw : raw.slice(0, q));
  const query = q === -1 ? '' : raw.slice(q + 1);
  const doc = state.byId.get(id) || state.byId.get(defaultId());
  if (!doc) return showError('No documents found.');
  try {
    await loadDoc(doc);
    state.current = doc;
    renderDoc(doc);
    const reqId = reqFromQuery(query);             // deep-link to a requirement or test
    if (reqId) requestAnimationFrame(() => revealRequirement(reqId));
    const testId = testFromQuery(query);
    if (testId) requestAnimationFrame(() => revealTest(testId));
  } catch (e) {
    showError('Could not load "' + id + '": ' + e.message);
  }
}
function defaultId() {
  return (state.site && state.site.defaultDoc) || (state.docs[0] && state.docs[0].id);
}
function showError(msg) {
  const content = el('content');
  content.textContent = '';
  const box = document.createElement('div');
  box.className = 'doc-error';
  box.textContent = msg;
  content.appendChild(box);
}
function navigate(id) {
  if (location.hash === '#/' + id) route(); else location.hash = '#/' + id;
}

// Per-test "Run" from a test-case block in a document: load results, open the
// runner for that one test, and refresh badges after saving.
function setupTestRun() {
  document.addEventListener('webdoc:run-test', async (e) => {
    const id = e.detail && e.detail.testId;
    const t = testList().find(x => x.id === id);
    if (!t) return;
    const res = await loadResults(state.site && state.site.sources);
    openRunner({
      tests: [t], results: res, sources: state.site && state.site.sources,
      onSaved: () => {
        setCoverageStatus(combinedStatus(requirementList(), testList(), res));
        if (state.current) renderDoc(state.current);
      }
    });
  });
}

// ---- Boot -----------------------------------------------------------------
async function boot() {
  setupTheme();
  appDrawer = setupDrawer();
  setupDocSearch();
  setupGraphButton();
  setupCoverageButton();
  setupEditButtons();
  setupTestRun();

  try {
    state.site = await loadSite();
  } catch (e) {
    return showError('Could not reach the server config. Is serve.py running? (' + e.message + ')');
  }
  el('brand').textContent = state.site.siteTitle || 'Documentation';

  // Load any opted-in renderer plugins (config "plugins"). Fault-tolerant: a
  // missing plugin or absent library is skipped, never blocking boot.
  await loadPlugins(state.site.plugins);

  state.docs = await discover(state.site.sources || []);
  // Load metadata for every doc once, so the tree, footer and search have titles.
  await Promise.all(state.docs.map(d => loadDoc(d).catch(() => d)));
  state.docs.forEach(d => state.byId.set(d.id, d));

  // Build the global requirement trace index (composed ids + calculated trace-from)
  // from every loaded doc body. Component ids come from the per-source config.
  await buildRequirementIndex(state.docs, state.site.sources);

  // All-documents search index (titles + headings).
  buildSearchIndex(state.docs);

  // Feed the link-popover URL autocomplete (used in the editor and coverage WYSIWYG).
  setLinkDocs(state.docs.map(d => ({ id: d.id, title: d.title || d.id })));

  // Test-coverage status, so requirement badges in the tables colour by pass/fail.
  try {
    const cov = await loadResults(state.site && state.site.sources);
    setCoverageStatus(combinedStatus(requirementList(), testList(), cov));
  } catch (e) { /* no results -> badges stay neutral */ }

  renderTree(el('treeList'), state.docs, id => { navigate(id); appDrawer.close(); });
  setupDrawerSearch(appDrawer);

  window.addEventListener('hashchange', route);
  if (!location.hash || !location.hash.startsWith('#/')) {
    location.replace('#/' + defaultId());
  }
  await route();

  document.body.setAttribute('data-app-ready', '1');
}

boot();
