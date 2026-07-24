// main.js - application entry point. Wires the shell together:
// theme, discovery, hash routing, the render pipeline, the drawer and search.
import { loadSite, discover, loadDoc } from './catalog.js';
import { renderMarkdown, INTERIM } from './commonmark.js';
import { sanitizeToFragment } from './sanitize.js';
import { numberHeadings, buildTOC } from './numbering.js';
import { renderTree, markActive } from './tree.js';
import { searchDocs } from './search.js';
import { createGraph } from './graph.js';
import { openEditor, openNewDocModal, parseDoc, setLinkDocs, setLinkSearch, richText, confirmDialog } from './editor.js';
import { loadResults, computeCoverage, computeTestStatus, testsFor, saveManual, manualTests, connectAutomated, disconnectAutomated, rememberAutoUrl, fetchXUnitCatalog } from './coverage.js';
import { generateReportHtml } from './report.js';
import { openRunner } from './runner.js';
import { highlightWithin } from './highlighter.js';
import { renderBlocks } from './blocks.js';
// (doclinks' documentLinks/resolveDocId are no longer used here - link data + resolution
// are server-backed now: the map comes from /api/index/graph and in-body links resolve
// via /api/index/resolve. See fetchGraphModel and resolveLinks. resolveResourceUrl stays:
// relative image resolution is pure client-side path math, shared with the editor.)
import { resolveResourceUrl } from './doclinks.js';
import { loadPlugins } from './plugins.js';
import { buildRequirementIndex, prepareDocGroups, preprocessRequirements, renderRequirements, revealRequirement, revealTest, reqFromQuery, testFromQuery, requirementTraceEdges, requirementList, testList, setCoverageStatus, inlineMarkdown, blockMarkdown, resolveRequirementRef } from './requirements.js';
import { state, el, combinedStatus, app } from './app-shell.js';
import { setupCoverageView } from './coverage-view.js';
import { elem, append } from './dom.js';

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
  let seq = 0, ctrl = null, timer = null;
  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (timer) clearTimeout(timer);
    if (ctrl) { try { ctrl.abort(); } catch (e) {} ctrl = null; }
    if (!q) { results.hidden = true; results.textContent = ''; tree.hidden = false; return; }
    tree.hidden = true; results.hidden = false;
    // Debounce keystrokes; AbortController cancels the in-flight request; a sequence
    // guard drops out-of-order responses so results never flicker.
    timer = setTimeout(async () => {
      const mySeq = ++seq;
      ctrl = new AbortController();
      results.textContent = '';
      append(results, elem('p', 'search-empty', 'Searching…'));
      let hits = [];
      try { hits = await searchDocs(q, 50, ctrl.signal); } catch (e) { hits = []; }
      if (mySeq !== seq) return;   // superseded by a newer keystroke
      results.textContent = '';
      if (!hits.length) { append(results, elem('p', 'search-empty', 'No documents match “' + q + '”.')); return; }
      for (const hit of hits) {
        append(results, elem('a', {
          class: 'search-hit', href: '#/' + hit.docId,
          onClick: ev => { if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return; ev.preventDefault(); navigate(hit.docId); drawer.close(); }
        },
          elem('span', 'search-hit-title', hit.title),
          hit.snippet && elem('span', 'search-hit-sub', hit.snippet)));
      }
    }, 200);
  });
}

// ---- Rendering pipeline ---------------------------------------------------
function renderDoc(doc) {
  const content = el('content');
  content.textContent = '';

  if (INTERIM) {
    content.appendChild(elem('div', {
      class: 'interim-banner',
      html: '<strong>Interim renderer.</strong> Layout preview only — the full, ' +
        'CommonMark-compliant engine (verified against spec.json) is the next phase and will ' +
        'replace this without changing anything else.'
    }));
  }

  // pipeline: extract requirement groups -> parse -> sanitize (inert) -> adopt
  const article = elem('article', 'doc', sanitizeToFragment(renderMarkdown(preprocessRequirements(doc.body || '', doc.id))));
  content.appendChild(article);

  // Surface the metadata description as a subtitle under the first heading.
  if (doc.description) {
    const lede = elem('p', 'doc-lede', doc.description);
    const h1 = article.querySelector('h1');
    if (h1) h1.after(lede); else article.prepend(lede);
  }

  const toc = numberHeadings(article);
  const tocList = el('tocList');
  tocList.textContent = '';
  tocList.appendChild(buildTOC(toc, content));

  // Build THIS document's requirement/test blocks from its (loaded) body - enriched
  // with the server-resolved trace-from / verified-by - then replace the placeholders.
  prepareDocGroups(doc.body || '', doc.id, doc.source);
  renderRequirements(article, doc.id);

  // Resolve in-body links: internal doc-id refs -> hash routes, in-page anchors
  // -> smooth scroll, external URLs -> open in a new tab. (Heading ids exist now.)
  resolveLinks(article, doc.id);
  // Resolve relative image sources to the doc's server folder (/docs/<source>/<dir>/).
  resolveImages(article, doc.id);

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
// Batch-resolve in-body link targets to doc ids via the server index. Lazy boot no
// longer holds every id client-side, so resolution (relative ./ ../, .md, full id,
// last-segment fallback, case-insensitive) is done server-side, authoritatively,
// against the whole corpus. Returns { cleanPath: resolvedId | null }.
async function resolveDocPaths(baseId, paths) {
  if (!paths.length) return {};
  const qs = 'base=' + encodeURIComponent(baseId || '') + paths.map(p => '&p=' + encodeURIComponent(p)).join('');
  try {
    const r = await fetch('/api/index/resolve?' + qs, { cache: 'no-cache' });
    if (!r.ok) return {};
    return (await r.json()).resolved || {};
  } catch (e) { return {}; }
}
// Rewrite in-body links after render: external URLs open in a new tab, in-page
// anchors scroll smoothly, and internal doc refs become #/ routes. Async because the
// internal refs are resolved in ONE batched request to the server index.
async function resolveLinks(article, baseId) {
  const internal = [];
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
    internal.push({ a: a, path: path, frag: frag });
  });
  if (!internal.length) return;
  const resolved = await resolveDocPaths(baseId, [...new Set(internal.map(x => x.path))]);
  for (const { a, path, frag } of internal) {
    const id = resolved[path];
    if (id) {
      a.setAttribute('href', '#/' + id);
      if (frag) a.addEventListener('click', () => setTimeout(() => {
        const t = el('content').querySelector('#' + cssEsc(decodeURIComponent(frag)));
        if (t) t.scrollIntoView({ block: 'start' });
      }, 140));
    } else {
      a.classList.add('doc-link-broken');
      a.title = 'Unresolved link';
      a.setAttribute('href', '#');                             // neutralise so middle-click/new-tab can't hit the server
      a.addEventListener('click', ev => ev.preventDefault());
    }
  }
}

// Resolve relative in-body image sources to the document's folder on the server. A
// Markdown image ![x](diagram.png) renders to <img src="diagram.png">, which the
// browser resolves against the app route (#/...) and 404s at the server root. Doc
// resources live NEXT TO the .md under /docs/<source>/<dir>/, so a relative src
// resolves there (../ and ./ handled by the URL parser). External (http/https/
// data/blob/protocol-relative) and root-absolute srcs are the author's explicit
// choice and left untouched. Pure client-side path math - no server lookup needed.
function resolveImages(article, baseId) {
  article.querySelectorAll('img[src]').forEach(img => {
    const url = resolveResourceUrl(baseId, img.getAttribute('src'));
    if (url) img.setAttribute('src', url);
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
  // Lazy boot no longer preloads every doc, so we can't cheaply verify a target
  // exists - link it with an id-derived title (a real title if it happens to be
  // cached); a dead link just lands on the not-found view when clicked.
  append(container,
    elem('span', 'foot-cap', caption),
    elem('ul', 'foot-links', ids.map(id => {
      const target = state.byId.get(id);
      return elem('li', null, elem('a', { href: '#/' + id }, (target && target.title) || titleFromId(id)));
    })));
}

// A display title derived from a doc id's last segment (lazy footer/stub fallback).
function titleFromId(id) {
  const base = String(id).split('/').pop().replace(/[-_]+/g, ' ');
  return base.replace(/\b\w/g, c => c.toUpperCase());
}

// Build a doc stub {id, source, rel, url, name} from an id, matching catalog.makeDoc,
// so route() can loadDoc it on demand (a 404 is the not-found signal).
function docFromId(id) {
  const slash = String(id).indexOf('/');
  if (slash < 0) return null;
  const source = id.slice(0, slash), rel = id.slice(slash + 1) + '.md';
  const url = '/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/');
  return { id: id, source: source, rel: rel, url: url, name: id.split('/').pop() + '.md' };
}
function getDoc(id) {
  let d = state.byId.get(id);
  if (!d && id) { d = docFromId(id); if (d) state.byId.set(id, d); }
  return d;
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
      const mark = elem('mark', 'find', s.slice(idx, idx + needle.length));
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

// The map's data now comes from the server's SQLite index (GET /api/index/graph),
// not from scanning every loaded doc body. Fetched once per open and cached;
// invalidated after an edit/create/delete (which updates the server index).
let graphModel = null;
function invalidateGraphModel() { graphModel = null; }
async function fetchGraphModel() {
  const empty = { docs: [], traceEdges: [], pageLinks: [], externalNodes: [] };
  let g;
  try { const res = await fetch('/api/index/graph', { cache: 'no-cache' }); if (!res.ok) return empty; g = await res.json(); }
  catch (e) { return empty; }
  const nodes = g.nodes || [];
  // Rebuild the docs[] that buildModel expects (assumes/next drive the hierarchy).
  const docs = nodes.map(n => ({ id: n[0], title: n[1], description: n[2] || '', assumes: [], next: [] }));
  for (const e of g.edges || []) {
    const f = e[0], t = e[1];
    if (f < 0 || t < 0) continue;
    if (e[2] === 0) docs[t].assumes.push(docs[f].id);   // prereq [P,D,0]: D assumes P
    else docs[f].next.push(docs[t].id);                 // recnext [D,S,1]: D.next = S
  }
  const externals = g.externals || [];
  const externalNodes = externals.map(u => ({ id: 'ext:' + u, url: u }));
  const traceEdges = (g.traces || []).filter(e => e[0] >= 0 && e[1] >= 0).map(e => ({ from: nodes[e[0]][0], to: nodes[e[1]][0] }));
  const pageLinks = [];
  for (const e of g.pageLinks || []) {
    const f = e[0]; if (f < 0) continue;
    if (e[2] >= 0) pageLinks.push({ from: nodes[f][0], to: 'ext:' + externals[e[2]] });
    else if (e[1] >= 0) pageLinks.push({ from: nodes[f][0], to: nodes[e[1]][0] });
  }
  return { docs: docs, traceEdges: traceEdges, pageLinks: pageLinks, externalNodes: externalNodes };
}
async function ensureGraphModel() { if (!graphModel) graphModel = await fetchGraphModel(); return graphModel; }

// (Re)build the document map. `keepView` restores the current pan/zoom (used
// after an edit-connections change so the view doesn't jump). Async: it fetches
// the server graph model (cached) before laying out.
async function buildDocGraph(keepView, animate, refit) {
  // Fetch the (cached) server graph model BEFORE touching the live graph, so the
  // current map stays on-screen during the await. Destroying first and THEN awaiting
  // left the map blank for a frame -> the "flash" on create/delete/edit rebuilds.
  // With the model in hand, destroy + recreate happen in ONE synchronous step.
  const model = await ensureGraphModel();
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
  // "Map by" mode picks which connection TYPE shapes the tree layout. It never
  // hides edges - every connection is still drawn; the legend toggles own visibility.
  const mode = docMapState.mapMode || 'all';
  const mapModes = [
    { value: 'all', label: 'All connections', swatch: 'all' },
    { value: 'recnext', label: 'Recommended next', swatch: 'recnext' },
    { value: 'prereq', label: 'Prerequisite', swatch: 'prereq' }
  ];
  graphApi = createGraph(docMapStage, model.docs, {
    currentId: focused ? docMapState.focusId : (state.current && state.current.id),
    traceEdges: model.traceEdges,
    pageLinks: model.pageLinks,
    externalNodes: model.externalNodes,
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
    onDelete: (id) => deleteDocFlow(id, { rebuildMap: true })   // Delete key on a selected node
    // No in-map "New document" button: the header's ＋ (title "New document") is
    // always available, so a second create button on the map was redundant.
  });
  if (docMapState.editMode) { graphApi.setEditMode(true); graphApi.setConnector(docMapState.connector); }
}
function setupGraphButton() {
  const btn = el('graphBtn');
  const stage = elem('div'); // becomes .graph-root, fills overlay
  const overlay = elem('div', { class: 'graph-overlay', id: 'graphOverlay', hidden: true }, stage);
  document.body.appendChild(overlay);
  docMapStage = stage;

  const open = async () => {
    if (app.closeCoverageView) app.closeCoverageView();   // only one overlay view at a time
    overlay.hidden = false;
    btn.setAttribute('aria-pressed', 'true');
    await buildDocGraph(false);
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

// Open the "new document" modal, from the header ＋. The modal opens OVER the
// current view (the map stays put) so nothing shifts while you name the doc; the
// map is only dismissed once you confirm and enterEdit opens the editor (which
// would otherwise sit behind the map overlay).
async function openNewDocFlow() {
  // The "already exists" guard must see EVERY doc, not just visited ones - boot is
  // lazy so state.byId is sparse, and checking it would let a new doc silently
  // overwrite an existing (unvisited) file. Use the server graph model's full id set.
  const known = new Set((await ensureGraphModel()).docs.map(d => d.id));
  // From the map, "New document" just creates the file (and the node appears) - it
  // does NOT drop you into the editor. From the reader, it opens the editor as usual.
  const fromMap = !el('graphOverlay').hidden;
  openNewDocModal({
    sources: (state.site && state.site.sources) || [],
    exists: (id) => known.has(id) || state.byId.has(id),
    onCreate: (id) => fromMap ? createDocInPlace(id) : startNewDoc(id)
  });
}

async function startNewDoc(id) {
  const title = id.split('/').pop().replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  await enterEdit(id, { title, description: '', assumes: [], next: [] },
    [{ type: 'heading', level: 1, html: title }, { type: 'paragraph', html: '' }], true);
}

// Create a minimal document on disk WITHOUT opening the editor (used from the map:
// the file is written + indexed and its node appears; the user stays on the map).
// The body is just the meta header + an H1 - the same shape serializeDoc emits.
async function createDocInPlace(id) {
  const title = titleFromId(id);
  const md = '<!--meta\n' + JSON.stringify({ title: title, description: '', assumes: [], next: [] }, null, 2) +
    '\n-->\n\n# ' + title + '\n';
  const slash = id.indexOf('/');
  const source = id.slice(0, slash), rel = id.slice(slash + 1) + '.md';
  let res;
  try {
    res = await fetch('/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/'),
      { method: 'PUT', body: md });
  } catch (e) { el('live').textContent = 'Create failed: ' + e.message; return; }
  if (!res.ok) { el('live').textContent = 'Create failed (' + res.status + ')'; return; }
  await refreshCatalog();                    // server re-indexed on PUT; invalidate the client graph model
  await renderTree(el('treeList'), tid => { navigate(tid); if (appDrawer) appDrawer.close(); });   // new file -> tree changed
  el('live').textContent = 'Created “' + title + '”.';
  if (!el('graphOverlay').hidden) buildDocGraph(true, true);   // rebuild the open map so the new node shows (keep view + animate)
}

async function editExisting(doc) {
  await loadDoc(doc);
  const parsed = parseDoc(doc.body || '', doc.meta || {});
  parsed.meta.title = doc.title || parsed.meta.title;
  parsed.meta.description = doc.description || parsed.meta.description;
  parsed.meta.assumes = (doc.assumes || []).slice();
  parsed.meta.next = (doc.next || []).slice();
  await enterEdit(doc.id, parsed.meta, parsed.blocks, false);
}

async function enterEdit(id, meta, blocks, isNew) {
  exitEdit();
  if (app.closeMapView) app.closeMapView();   // opening the editor: dismiss the map so it isn't left behind the editor
  document.body.classList.add('is-editing');
  // The metadata pickers (Assumed knowledge / Recommended next) need the full doc
  // list. Boot no longer holds one (lazy/server-backed), so pull it from the same
  // server graph model the map uses (cached; invalidated after a create/delete/edit).
  const allDocs = (await ensureGraphModel()).docs;
  editorEl = openEditor({
    docId: id, meta, blocks, isNew,
    sources: (state.site && state.site.sources) || [],
    allDocs: allDocs,
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
  const cached = state.byId.get(id); if (cached) cached._loaded = false;   // force a fresh reload of the new body
  await refreshCatalog();
  if (wasNew) await renderTree(el('treeList'), tid => { navigate(tid); if (appDrawer) appDrawer.close(); });   // new file -> tree structure changed
  exitEdit();
  navigate(id);
}

// After a write the SERVER index updates itself (serve.py do_PUT/do_DELETE hooks),
// so the client only INVALIDATES caches and reloads what's affected - never re-walks
// or re-loads the corpus (the old O(N)-on-every-save trap). Tree re-rendering happens
// only at the specific create/delete sites, since a plain edit changes no structure.
async function refreshCatalog() {
  invalidateGraphModel();
  await buildRequirementIndex(null, state.site.sources);   // refresh the global req index (cheap, server-side)
  if (state.current) {
    state.current._loaded = false;                         // its body may have changed on disk
    try { await loadDoc(state.current); } catch (e) { /* deleted; caller navigates away */ }
  }
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
  if (!id) return;
  const doc = getDoc(id);
  const title = (doc && doc.title) || titleFromId(id);
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
  state.byId.delete(id);
  await refreshCatalog();
  await renderTree(el('treeList'), tid => { navigate(tid); if (appDrawer) appDrawer.close(); });   // structure changed
  el('live').textContent = 'Deleted “' + title + '”.';
  // If the reading view was showing the deleted doc, move it to a surviving one.
  if (wasCurrent) {
    const next = defaultId();
    if (next && next !== id) navigate(next); else showError('No documents left.');
  }
  // Refresh an open map in place so the deleted node is gone (keep view + animate).
  if (opts && opts.rebuildMap && !el('graphOverlay').hidden) buildDocGraph(true, true);
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
  const doc = getDoc(id) || getDoc(defaultId());   // lazy: id -> stub -> loadDoc on demand
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
  // state.docs is empty under lazy boot; a configured defaultDoc is expected.
}
function showError(msg) {
  const content = el('content');
  content.textContent = '';
  content.appendChild(elem('div', 'doc-error', msg));
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

// ---- First-run index build progress ---------------------------------------
// While the server builds its SQLite index for the first time on a large corpus,
// the /api/index/* endpoints aren't ready - so show a progress bar (driven by
// /api/index/status) instead of a blank app. Warm restarts report "ready" at once,
// so this returns immediately and nothing is shown.
let indexOverlay = null;
function showIndexOverlay() {
  if (indexOverlay) return;
  const fill = elem('div', 'index-progress-fill');
  const track = elem('div', 'index-progress is-indeterminate', fill);
  const stat = elem('div', 'index-loading-stat', 'Scanning files…');
  const ov = elem('div', 'index-loading',
    elem('div', 'index-loading-card',
      elem('div', 'index-loading-brand', (state.site && state.site.siteTitle) || 'Documentation'),
      elem('div', 'index-loading-title', 'Preparing the document index…'),
      track,
      stat,
      elem('div', 'index-loading-note', 'First-time indexing of this library. Later starts are near-instant.')));
  document.body.appendChild(ov);
  el('live').textContent = 'Preparing the document index.';
  indexOverlay = { ov: ov, track: track, fill: fill, stat: stat };
}
function updateIndexOverlay(s) {
  if (!indexOverlay) return;
  const pct = Math.max(0, Math.min(100, s.pct || 0));
  const scanning = !pct && !s.docs;   // walk phase: total not known yet -> indeterminate
  indexOverlay.track.classList.toggle('is-indeterminate', scanning);
  if (!scanning) indexOverlay.fill.style.width = pct + '%';
  indexOverlay.stat.textContent = scanning
    ? 'Scanning files…'
    : (Number(s.docs || 0).toLocaleString() + ' documents indexed · ' + pct + '%');
}
function hideIndexOverlay() {
  if (!indexOverlay) return;
  indexOverlay.ov.remove();
  indexOverlay = null;
}
// Block boot until the server index is ready, showing progress if it's a cold build.
async function waitForIndex() {
  for (;;) {
    let s;
    try {
      const r = await fetch('/api/index/status', { cache: 'no-cache' });
      if (!r.ok) break;              // index disabled / unavailable -> proceed (app degrades gracefully)
      s = await r.json();
    } catch (e) { break; }
    if (!s || s.state === 'ready' || s.state === 'error') break;
    showIndexOverlay();
    updateIndexOverlay(s);
    await new Promise(res => setTimeout(res, 600));
  }
  hideIndexOverlay();
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

  // On a first-time cold index build, wait here with a progress bar (the tree /
  // search / map all need the index). Warm starts pass through instantly.
  await waitForIndex();

  // LAZY boot: do NOT discover + load every document body (the old ceiling). The
  // global requirement/test index comes from the server's SQLite index; individual
  // documents load on demand when viewed; the tree, all-docs search and the map are
  // all server-backed. Boot cost is now flat regardless of corpus size.
  state.docs = [];
  await buildRequirementIndex(null, state.site.sources);
  // Editor link autocomplete: server-backed title/id suggestions via the search index
  // (scales past any client-held document list).
  setLinkSearch(async q => (await searchDocs(q, 8)).map(h => ({ id: h.docId, title: h.title })));

  // Test-coverage status, so requirement badges in the tables colour by pass/fail.
  try {
    const cov = await loadResults(state.site && state.site.sources);
    setCoverageStatus(combinedStatus(requirementList(), testList(), cov));
  } catch (e) { /* no results -> badges stay neutral */ }

  await renderTree(el('treeList'), id => { navigate(id); appDrawer.close(); });
  setupDrawerSearch(appDrawer);

  window.addEventListener('hashchange', route);
  if (!location.hash || !location.hash.startsWith('#/')) {
    location.replace('#/' + defaultId());
  }
  await route();

  document.body.setAttribute('data-app-ready', '1');
}

boot();
