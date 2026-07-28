// reader.js - the reading-view render pipeline: turn a loaded document into the
// rendered article (markdown -> sanitized DOM -> numbered headings + TOC ->
// requirement/test tables -> resolved links/images -> diagrams -> highlighting),
// plus the footer, scroll-spy and in-document find. Extracted from main.js; the
// shell (routing, test-run) calls renderDoc / setupDocSearch, nothing here reaches
// back into the map or authoring areas.
import { elem, append } from './dom.js';
import { state, el, titleFromId } from './app-shell.js';
import { renderMarkdown } from './commonmark.js';
import { sanitizeToFragment } from './sanitize.js';
import { numberHeadings, buildTOC } from './numbering.js';
import { preprocessRequirements, prepareDocGroups, renderRequirements } from './requirements.js';
import { renderBlocks } from './blocks.js';
import { highlightWithin } from './highlighter.js';
import { markActive } from './tree.js';
import { resolveResourceUrl } from './doclinks.js';

/** @typedef {import('./catalog.js').Doc} Doc */

/**
 * Render `doc` into the reading-view content pane: parse and sanitize its Markdown
 * body, inject the description subtitle, number the headings and build the TOC,
 * fill in the requirement/test-case placeholders, resolve in-body links and images,
 * run any pluggable block renderers and the syntax highlighter, wire up scroll-spy,
 * and refresh the header/footer chrome. The single entry point the shell's router
 * calls on every document navigation.
 * @param {Doc} doc
 * @returns {void}
 */
export function renderDoc(doc) {
  const content = el('content');
  content.textContent = '';

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

// A CSS.escape shim for building `#id` selectors from arbitrary heading/anchor ids.
function cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/([^\w-])/g, '\\$1'); }

// Batch-resolve in-body link targets to doc ids via the server index. Lazy boot no
// longer holds every id client-side, so resolution (relative ./ ../, .md, full id,
// last-segment fallback, case-insensitive) is done server-side, authoritatively,
// against the whole corpus. Returns { cleanPath: resolvedId | null }.
/**
 * @param {string} baseId
 * @param {string[]} paths
 * @returns {Promise<Object<string, string|null>>} map of input path -> resolved doc id, or null if unresolved (every requested path is present as a key)
 */
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
/**
 * @param {HTMLElement} article
 * @param {string} baseId
 * @returns {Promise<void>}
 */
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
// resolves there (../ and ./ handled by the URL parser). External and root-absolute
// srcs are the author's explicit choice and left untouched. Pure client-side math.
/**
 * @param {HTMLElement} article
 * @param {string} baseId
 * @returns {void}
 */
function resolveImages(article, baseId) {
  article.querySelectorAll('img[src]').forEach(img => {
    const url = resolveResourceUrl(baseId, img.getAttribute('src'));
    if (url) img.setAttribute('src', url);
  });
}

// Footer shows the current document's OWN metadata: every "assumed knowledge"
// entry (read first) and every "recommended next" entry - each may be several.
/**
 * @param {Doc} doc
 * @returns {void}
 */
function renderFooter(doc) {
  buildFootGroup(el('footPrev'), doc.assumes || [], '‹ Assumed knowledge', false);
  buildFootGroup(el('footNext'), doc.next || [], 'Recommended next ›', true);
}
/**
 * @param {HTMLElement} container
 * @param {string[]} ids
 * @param {string} caption
 * @param {boolean} isNext
 * @returns {void}
 */
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

// Highlight the TOC entry whose heading is in view (an IntersectionObserver over the
// content pane). One observer at a time; rebuilt for each rendered document.
let spyObserver = null;
/**
 * @param {HTMLElement} article
 * @param {HTMLElement} tocList
 * @returns {void}
 */
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
/**
 * Wire the in-document search box: on every input, clear the previous highlights
 * and, once the query reaches 2 characters, highlight all matches in the currently
 * rendered article and smooth-scroll to the first one.
 * @returns {void}
 */
export function setupDocSearch() {
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
/**
 * @param {HTMLElement} root
 * @returns {void}
 */
function clearHighlights(root) {
  root.querySelectorAll('mark.find').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
  root.normalize();
}
/**
 * Wrap every case-insensitive occurrence of `q` in `root`'s text nodes (skipping
 * pre/code/mark, so previous highlights and code blocks are left alone) in a
 * <mark class="find">.
 * @param {HTMLElement} root
 * @param {string} q
 * @returns {HTMLElement|null} the first inserted mark, for scroll-into-view, or null if no match
 */
function highlight(root, q) {
  const needle = q.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement.closest('pre,code,mark') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
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
