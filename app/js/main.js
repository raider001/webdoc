// main.js - application entry point. Wires the shell together:
// theme, discovery, hash routing, the render pipeline, the drawer and search.
import { loadSite, discover, loadDoc } from './catalog.js';
import { renderMarkdown, INTERIM } from './commonmark.js';
import { sanitizeToFragment } from './sanitize.js';
import { numberHeadings, buildTOC } from './numbering.js';
import { renderTree, markActive, filterTree } from './tree.js';
import { createGraph } from './graph.js';
import { highlightWithin } from './highlighter.js';
import { buildRequirementIndex, preprocessRequirements, renderRequirements, revealRequirement, reqFromQuery, requirementTraceEdges } from './requirements.js';

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
    overlay.hidden = false;
    btn.setAttribute('aria-pressed', 'true');
    if (graphApi) graphApi.destroy();
    graphApi = createGraph(stage, state.docs, {
      currentId: state.current && state.current.id,
      traceEdges: requirementTraceEdges(),
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

  btn.addEventListener('click', () => (overlay.hidden ? open() : close()));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });
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
    const reqId = reqFromQuery(query);             // deep-link to a requirement
    if (reqId) requestAnimationFrame(() => revealRequirement(reqId));
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

// ---- Boot -----------------------------------------------------------------
async function boot() {
  setupTheme();
  const drawer = setupDrawer();
  setupDocSearch();
  setupGraphButton();

  try {
    state.site = await loadSite();
  } catch (e) {
    return showError('Could not reach the server config. Is serve.py running? (' + e.message + ')');
  }
  el('brand').textContent = state.site.siteTitle || 'Documentation';

  state.docs = await discover(state.site.sources || []);
  // Load metadata for every doc once, so the tree, footer and search have titles.
  await Promise.all(state.docs.map(d => loadDoc(d).catch(() => d)));
  state.docs.forEach(d => state.byId.set(d.id, d));

  // Build the global requirement trace index (composed ids + calculated trace-from)
  // from every loaded doc body. Component ids come from the per-source config.
  await buildRequirementIndex(state.docs, state.site.sources);

  renderTree(el('treeList'), state.docs, id => { navigate(id); drawer.close(); });
  el('treeSearch').addEventListener('input', e => filterTree(el('treeList'), state.docs, e.target.value));

  window.addEventListener('hashchange', route);
  if (!location.hash || !location.hash.startsWith('#/')) {
    location.replace('#/' + defaultId());
  }
  await route();

  document.body.setAttribute('data-app-ready', '1');
}

boot();
