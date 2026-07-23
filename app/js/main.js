// main.js - application entry point. Wires the shell together:
// theme, discovery, hash routing, the render pipeline, the drawer and search.
import { loadSite, discover, loadDoc } from './catalog.js';
import { renderMarkdown, INTERIM } from './commonmark.js';
import { sanitizeToFragment } from './sanitize.js';
import { numberHeadings, buildTOC } from './numbering.js';
import { renderTree, markActive } from './tree.js';
import { buildSearchIndex, searchDocs } from './search.js';
import { createGraph } from './graph.js';
import { openEditor, openNewDocModal, parseDoc, setLinkDocs, richText, confirmDialog } from './editor.js';
import { loadResults, computeCoverage, computeTestStatus, testsFor, saveManual, manualTests, connectAutomated, disconnectAutomated, rememberAutoUrl, fetchXUnitCatalog } from './coverage.js';
import { generateReportHtml } from './report.js';
import { openRunner } from './runner.js';
import { documentLinks, resolveDocId as resolveDocIdShared } from './doclinks.js';
import { highlightWithin } from './highlighter.js';
import { renderBlocks } from './blocks.js';
import { loadPlugins } from './plugins.js';
import { buildRequirementIndex, preprocessRequirements, renderRequirements, revealRequirement, revealTest, reqFromQuery, testFromQuery, requirementTraceEdges, requirementList, testList, setCoverageStatus, inlineMarkdown, blockMarkdown, resolveRequirementRef } from './requirements.js';
import { state, el, combinedStatus, app } from './app-shell.js';
import { setupCoverageView } from './coverage-view.js';

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
  resolveLinks(article, doc.id);

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
// Resolve an in-body ref (relative ./ ../, .md, or a full doc id) to a doc id.
// Delegates to the shared resolver in doclinks.js so the reader and the map's
// link classifier never disagree.
function resolveDocId(path, baseId) { return resolveDocIdShared(path, baseId, state.byId); }
function resolveLinks(article, baseId) {
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
    const path = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw).replace(/\.md$/i, '').replace(/\/+$/, '');
    const frag = hashIdx >= 0 ? raw.slice(hashIdx + 1) : '';
    const id = resolveDocId(path, baseId);
    if (id) {
      a.setAttribute('href', '#/' + id);
      if (frag) a.addEventListener('click', () => setTimeout(() => {
        const t = el('content').querySelector('#' + cssEsc(decodeURIComponent(frag)));
        if (t) t.scrollIntoView({ block: 'start' });
      }, 140));
    } else {
      a.classList.add('doc-link-broken');
      a.title = 'Unresolved link: ' + raw;
      a.setAttribute('href', '#');                             // neutralise so middle-click/new-tab can't hit the server
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

// The map and coverage views are both full-screen overlays; only one at a time -
// each registers its close() on the shared `app` registry (app.closeMapView /
// app.closeCoverageView) so the other overlay can dismiss it without a hard import.

// ---- Map (document-relationship graph) ------------------------------------
let graphApi = null;
let docMapStage = null;
const docMapState = { editMode: false, connector: 'recnext', mapMode: 'all', transform: null, focusMode: false, focusId: null }; // persisted across rebuilds (transform = last pan/zoom; focusId = radial-focus centre)

// (Re)build the document map. `keepView` restores the current pan/zoom (used
// after an edit-connections change so the view doesn't jump).
function buildDocGraph(keepView, animate, refit) {
  // Restore the map's last pan/zoom (persisted in docMapState.transform) so it
  // survives close/reopen, switching between views, and tree-update rebuilds -
  // EXCEPT on a focus change (refit), where the layout differs enough that we fit
  // fresh to the new radial/hierarchy frame. First-ever open also fits.
  let initialTransform = refit ? undefined : docMapState.transform, animateFrom;
  if (graphApi) {
    const es = graphApi.getEditState(); docMapState.editMode = es.editMode; docMapState.connector = es.connector;
    docMapState.transform = graphApi.getTransform();   // remember the live view
    if (!refit) initialTransform = docMapState.transform;   // ...and restore it on an in-place rebuild
    if (animate && graphApi.getNodePositions) animateFrom = graphApi.getNodePositions();
    graphApi.destroy();
  }
  const focused = !!(docMapState.focusMode && docMapState.focusId);
  const traces = requirementTraceEdges();
  const links = documentLinks(state.docs, traces);
  // "Map by" mode picks which connection TYPE shapes the tree layout. It never
  // hides edges - every connection is still drawn; the legend toggles own visibility.
  const mode = docMapState.mapMode || 'all';
  const mapModes = [
    { value: 'all', label: 'All connections', swatch: 'all' },
    { value: 'recnext', label: 'Recommended next', swatch: 'recnext' },
    { value: 'prereq', label: 'Prerequisite', swatch: 'prereq' }
  ];
  graphApi = createGraph(docMapStage, state.docs, {
    currentId: focused ? docMapState.focusId : (state.current && state.current.id),
    traceEdges: traces,
    pageLinks: links.pageLinks,
    externalNodes: links.externalNodes,
    initialTransform: initialTransform,
    animateFrom: animateFrom,
    mapModes: mapModes,
    mapMode: mode,
    onMapMode: (m) => { docMapState.mapMode = m; buildDocGraph(true, true); },  // relayout + animate the rearrange
    focusMode: docMapState.focusMode,
    focusId: focused ? docMapState.focusId : null,
    onFocusToggle: () => {                           // toggle focus mode; leaving it returns to the hierarchy
      docMapState.focusMode = !docMapState.focusMode;
      if (!docMapState.focusMode) docMapState.focusId = null;
      buildDocGraph(false, true, true);            // re-fit to the new frame
    },
    onSelect: (id) => {                             // focus mode: a click centres the map on the node + its links
      if (docMapState.focusMode) {
        docMapState.focusId = (docMapState.focusId === id) ? null : id;   // re-clicking the centre returns to the hierarchy
        buildDocGraph(false, true, true);
      } else { navigate(id); }                      // normal mode: select it, stay on the map
    },
    onActivate: (id) => { if (app.closeMapView) app.closeMapView(); navigate(id); }, // dbl-click: open + leave
    onConnect: async (sourceId, targetId, type) => {   // A then B: add to A's meta
      const field = type === 'prereq' ? 'assumes' : 'next';
      if (await editDocRelation(sourceId, targetId, field, 'add')) buildDocGraph(true, true);
    },
    onDisconnect: async (fromId, toId, type) => {       // remove the drawn edge
      const ok = type === 'prereq'
        ? await editDocRelation(toId, fromId, 'assumes', 'remove')   // prereq edge P->D means D assumes P
        : await editDocRelation(fromId, toId, 'next', 'remove');     // recnext edge D->S means D.next has S
      if (ok) buildDocGraph(true, true);
    },
    onDelete: (id) => deleteDocFlow(id, { rebuildMap: true }),  // Delete key on a selected node
    onCreate: () => openNewDocFlow()                            // "New document" button (modal opens over the map)
  });
  if (docMapState.editMode) { graphApi.setEditMode(true); graphApi.setConnector(docMapState.connector); }
}
function setupGraphButton() {
  const btn = el('graphBtn');
  const overlay = document.createElement('div');
  overlay.className = 'graph-overlay';
  overlay.id = 'graphOverlay';
  overlay.hidden = true;
  const stage = document.createElement('div'); // becomes .graph-root, fills overlay
  overlay.appendChild(stage);
  document.body.appendChild(overlay);
  docMapStage = stage;

  const open = () => {
    if (app.closeCoverageView) app.closeCoverageView();   // only one overlay view at a time
    overlay.hidden = false;
    btn.setAttribute('aria-pressed', 'true');
    buildDocGraph(false);
    el('live').textContent = 'Opened the document map. Click a document to select it; double-click to open it. Escape closes.';
  };
  const close = () => {
    if (overlay.hidden) return;
    overlay.hidden = true;
    btn.setAttribute('aria-pressed', 'false');
    docMapState.editMode = false;                 // start fresh next open
    if (graphApi) { docMapState.transform = graphApi.getTransform(); graphApi.destroy(); graphApi = null; }  // remember the view
    el('content').focus({ preventScroll: true });
  };

  app.closeMapView = close;
  btn.addEventListener('click', () => (overlay.hidden ? open() : close()));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || overlay.hidden) return;
    if (docMapState.focusMode && docMapState.focusId) { docMapState.focusId = null; buildDocGraph(false, true, true); }  // Esc: leave the focused node -> hierarchy
    else close();
  });
}

// ---- Test coverage view -------------------------------------------------
// The full-screen Test Coverage overlay lives in ./coverage-view.js
// (setupCoverageView); it hangs its close() on app.closeCoverageView.

// ---- Editor (WYSIWYG authoring) -------------------------------------------
let appDrawer = null;
let editorEl = null;

function setupEditButtons() {
  el('newDocBtn').addEventListener('click', () => openNewDocFlow());
  el('editBtn').addEventListener('click', () => { if (state.current) editExisting(state.current); });
  el('deleteBtn').addEventListener('click', () => { if (state.current) deleteDocFlow(state.current.id, { rebuildMap: false }); });
}

// Open the "new document" modal, from the header ＋ or the map's New button. The
// modal opens OVER the current view (the map stays put) so nothing shifts while
// you name the doc; the map is only dismissed once you confirm and enterEdit opens
// the editor (which would otherwise sit behind the map overlay).
function openNewDocFlow() {
  openNewDocModal({
    sources: (state.site && state.site.sources) || [],
    exists: (id) => state.byId.has(id),
    onCreate: (id) => startNewDoc(id)
  });
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
  if (app.closeMapView) app.closeMapView();   // opening the editor: dismiss the map so it isn't left behind the editor
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
  // Re-point state.current at the fresh doc object (or null if it was removed).
  if (state.current) state.current = state.byId.get(state.current.id) || null;
  await buildRequirementIndex(state.docs, state.site.sources);
  buildSearchIndex(state.docs);
  renderTree(el('treeList'), state.docs, (docId) => { navigate(docId); if (appDrawer) appDrawer.close(); });
}

// ---- Delete a document (CRUD) ---------------------------------------------
async function deleteDocRequest(id) {
  const slash = id.indexOf('/');
  const source = id.slice(0, slash), rel = id.slice(slash + 1) + '.md';
  const url = '/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/');
  try {
    const res = await fetch(url, { method: 'DELETE' });
    if (res.ok) return { ok: true };
    let msg = 'server returned ' + res.status;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
    return { ok: false, error: msg };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Confirm, delete, refresh the catalog, then move off the deleted document.
// `rebuildMap` re-renders an open map so the deleted node disappears in place.
async function deleteDocFlow(id, opts) {
  if (!id || !state.byId.has(id)) return;
  const doc = state.byId.get(id);
  const title = (doc && doc.title) || id;
  const confirmed = await confirmDialog({
    title: 'Delete this document?',
    message: '“' + title + '” (' + id + '.md) will be permanently deleted from disk. This can’t be undone.',
    confirmLabel: 'Delete', danger: true
  });
  if (!confirmed) return;
  const wasCurrent = !!(state.current && state.current.id === id);
  const r = await deleteDocRequest(id);
  if (!r.ok) {
    el('live').textContent = 'Delete failed: ' + r.error;
    await confirmDialog({ title: 'Delete failed', message: r.error, confirmLabel: 'OK', cancelLabel: null });
    return;
  }
  await refreshCatalog();
  el('live').textContent = 'Deleted “' + title + '”.';
  // If the reading view was showing the deleted doc, move it to a surviving one.
  if (wasCurrent) {
    const next = state.byId.has(defaultId()) ? defaultId() : (state.docs[0] && state.docs[0].id);
    if (next) navigate(next); else showError('No documents left.');
  }
  // Refresh an open map in place so the deleted node is gone.
  if (opts && opts.rebuildMap && !el('graphOverlay').hidden) buildDocGraph(false);
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
// Expose the two test<->requirement editors to the coverage view (which lives in
// its own module and links/unlinks tests from a requirement's report panel).
app.linkTestToRequirement = linkTestToRequirement;
app.unlinkTestFromRequirement = unlinkTestFromRequirement;

// Add/remove an id in a document's own `<!--meta-->` header list (assumes|next).
// Used by the map's "Edit connections" mode to author relationships directly.
function editDocMetaBody(body, field, addId, removeId) {
  const s = String(body);
  const m = s.match(/^(﻿?)<!--meta\s*(\{[\s\S]*?\})\s*-->/);
  if (!m) return s;                                  // no doc-level meta header to edit
  let meta; try { meta = JSON.parse(m[2]); } catch (e) { return s; }
  let arr = Array.isArray(meta[field]) ? meta[field].map(String) : [];
  if (addId && arr.indexOf(addId) === -1) arr.push(addId);
  if (removeId) arr = arr.filter(x => x !== removeId);
  meta[field] = arr;
  return (m[1] || '') + '<!--meta\n' + JSON.stringify(meta, null, 2) + '\n-->' + s.slice(m[0].length);
}
async function editDocRelation(fromId, toId, field, action) {  // field: 'assumes'|'next'; action: 'add'|'remove'
  if (!fromId || !toId || fromId === toId) return false;
  const slash = fromId.indexOf('/');
  const source = fromId.slice(0, slash), rel = fromId.slice(slash + 1) + '.md';
  const url = '/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/');
  // Edit the RAW file: discovery strips the doc-level <!--meta--> out of doc.body,
  // so we fetch the on-disk markdown (header intact), rewrite it, and PUT it back.
  let raw;
  try { const r = await fetch(url); if (!r.ok) return false; raw = await r.text(); }
  catch (e) { return false; }
  const newBody = editDocMetaBody(raw, field, action === 'add' ? toId : null, action === 'remove' ? toId : null);
  if (newBody === raw) return true;                  // already in the desired state
  let res;
  try { res = await fetch(url, { method: 'PUT', body: newBody }); }
  catch (e) { return false; }
  if (!res.ok) return false;
  await refreshCatalog();
  return true;
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
  setupCoverageView();
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
