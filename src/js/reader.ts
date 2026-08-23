// reader.ts - the reading-view render pipeline: turn a loaded document into the
// rendered article (markdown -> sanitized DOM -> numbered headings + TOC ->
// requirement/test tables -> resolved links/images -> diagrams -> highlighting),
// plus the footer, scroll-spy and in-document find. Extracted from main.ts; the
// shell (routing, test-run) calls renderDoc / setupDocSearch, nothing here reaches
// back into the map or authoring areas.
import { elem } from './dom.js';
import { state, el, mustEl, app } from './app-shell.js';
import { renderMarkdown } from './commonmark.js';
import { sanitizeToFragment } from './sanitize.js';
import { numberHeadings } from './numbering.js';
import { preprocessRequirements, prepareDocGroups, renderRequirements } from './requirements.js';
import { renderBlocks } from './blocks.js';
import { highlightWithin } from './highlighter.js';
import { resolveResourceUrl } from './doclinks.js';
import { restrictedSection } from './auth-ui.js';
import { announce } from './announce.js';

import type { Doc } from './catalog.js';
import type { TocEntry } from './numbering.js';
import type { RestrictedSectionSpec } from './auth-ui.js';

// ---- Mounted components inside the article --------------------------------
// Requirement tables and test blocks are Svelte components mounted into
// placeholder nodes inside the article. The article is destroyed and rebuilt on
// every navigation, so each mount MUST be torn down first: a component whose
// target is merely detached keeps its effects alive against nodes nobody can
// see.
//
// The registry is filled from two places, both through the `app` registry rather
// than by importing this file (either import would close a cycle):
// requirements/render.js, for every requirement group and test case in the
// document, and auth-ui.ts, for a restricted-section notice. It is the ONLY such
// registry - a second one would mean a teardown path that some mounts are not on.
const mountedInArticle = new Map<Element, () => void>();

/**
 * Record a component mounted inside the article so it can be destroyed when the
 * article is replaced. `host` is the .wd-mounted element it was mounted into.
 */
export function registerMounted(host: Element, destroy: () => void): void { mountedInArticle.set(host, destroy); }

/**
 * Destroy every component mounted inside `root`, then forget them. Safe to call
 * when nothing is registered.
 */
export function teardownMounted(root: Element): void {
  for (const [host, destroy] of mountedInArticle) {
    if (!root.contains(host)) continue;
    try { destroy(); } catch (e) { /* a failed teardown must not block the render */ }
    mountedInArticle.delete(host);
  }
}

/**
 * Push this document's breadcrumb, TOC and footer lists into the island store,
 * then FLUSH.
 *
 * The flush is not optional. Rune writes are applied in a microtask, but
 * setupScrollSpy() reads tocList.querySelectorAll('a[data-target]') later in
 * this same tick, and main.ts sets body[data-app-ready="1"] as soon as route()
 * returns - six e2e assertions gate on that attribute meaning the page is
 * actually rendered. Without the flush the scroll-spy map is empty, no TOC entry
 * is ever marked .active, and nothing throws.
 */
function setDocChrome(doc: Doc, toc: TocEntry[]): void {
  if (!app.setDocChrome) return;   // island not mounted (a test harness, or a failed boot)
  app.setDocChrome(doc.id, toc, doc.assumes || [], doc.next || []);
}

/**
 * Render `doc` into the reading-view content pane: parse and sanitize its Markdown
 * body, inject the description subtitle, number the headings and build the TOC,
 * fill in the requirement/test-case placeholders, resolve in-body links and images,
 * run any pluggable block renderers and the syntax highlighter, wire up scroll-spy,
 * and refresh the header/footer chrome. The single entry point the shell's router
 * calls on every document navigation.
 */
export function renderDoc(doc: Doc): void {
  const content = mustEl('content');
  // Tear down anything mounted INSIDE the previous article before the DOM it
  // lives in is destroyed. `content.textContent = ''` detaches nodes; it does
  // not stop a component's effects, which would go on running against detached
  // nodes for the rest of the session - one badge-repaint effect per requirement
  // row, per document ever visited, since renderDoc also fires on the
  // four-second external-change poll and after every runner save.
  teardownMounted(content);
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

  // numberHeadings still MUTATES the article - it stamps the ids and the
  // `.secnum` labels onto the real headings - and returns the flat list the TOC
  // component renders. The mutation stays vanilla because it edits document
  // CONTENT; only its return value crosses into the store.
  const toc = numberHeadings(article);
  const tocList = mustEl('tocList');
  setDocChrome(doc, toc);

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

  // Restricted sections: the SERVER replaced each one it withheld with a fenced
  // ```wd-restricted block before sending the file. Swap those for a proper
  // notice here - after the block renderers, so a plugin never sees them, and
  // before highlighting, so they are not styled as code.
  renderRestrictedSections(article);

  // Syntax highlighting: post-sanitize, over the remaining code blocks.
  highlightWithin(article);

  setupScrollSpy(article, tocList);

  // header + footer chrome. Breadcrumb, TOC and both footer groups are all
  // driven by setDocChrome() above; what is left here is the parts no component
  // owns - the document title, and the two footer containers' hidden flags
  // (they are the components' MOUNT TARGETS, so a component cannot set them).
  document.title = doc.title + ' — ' + ((state.site && state.site.siteTitle) || 'Documentation');
  mustEl('footPrev').hidden = !(doc.assumes && doc.assumes.length);
  mustEl('footNext').hidden = !(doc.next && doc.next.length);
  // "On this page" is meaningless for a document with no headings.
  const tocPane = el('toc');
  if (tocPane) tocPane.hidden = !toc.length;
  if (app.setTreeActive) app.setTreeActive(doc.id);   // highlight + reveal in the drawer tree
  // Offer edit/delete only where this account could actually use them (authoring.ts
  // registers this; the server still re-checks every write).
  if (app.updateDocActions) app.updateDocActions(doc.id);

  content.scrollTop = 0;
  content.focus({ preventScroll: true });
  announce('Loaded: ' + doc.title);
}

/**
 * Replace every ```wd-restricted fence the server left behind with the
 * restricted-section notice.
 *
 * The placeholder is produced server-side (webdoc_access.redact_sections) and is
 * the ONLY thing that arrived in place of the withheld markdown - so if this
 * function never ran, the reader would see an inert JSON code block, not the
 * content. That is the intended failure mode: ugly, never leaky.
 *
 * Since Phase 5 the notice is a Svelte island: restrictedSection() hands back a
 * `.wd-mounted` HOST synchronously and fills it a microtask later. The swap is
 * unchanged because the host is a real element from the moment it is returned -
 * and because the article is already in the document by the time this runs, so
 * the host is connected and the pending mount goes ahead. Teardown is registered
 * by auth-ui.ts through app.registerMounted, which is this module's own
 * registerMounted; a direct import back into here would be a cycle.
 */
function renderRestrictedSections(article: HTMLElement): void {
  article.querySelectorAll('pre > code.language-wd-restricted').forEach(code => {
    let spec: RestrictedSectionSpec = {};
    try { spec = JSON.parse(code.textContent || '{}') || {}; } catch (e) { spec = {}; }
    const pre = code.parentElement;
    if (pre && pre.parentElement) pre.replaceWith(restrictedSection(spec));
  });
}

// A CSS.escape shim for building `#id` selectors from arbitrary heading/anchor ids.
function cssEsc(s: string): string { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/([^\w-])/g, '\\$1'); }

// Batch-resolve in-body link targets to doc ids via the server index. Lazy boot no
// longer holds every id client-side, so resolution (relative ./ ../, .md, full id,
// last-segment fallback, case-insensitive) is done server-side, authoritatively,
// against the whole corpus. Returns { cleanPath: resolvedId | null } - a map of
// input path -> resolved doc id, or null if unresolved (every requested path is
// present as a key).
async function resolveDocPaths(baseId: string, paths: string[]): Promise<Record<string, string | null>> {
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
 * One in-body link waiting on the batched resolve: the anchor itself, plus its
 * authored href already split into the path to resolve and the #fragment to
 * scroll to once the route lands.
 */
interface PendingDocLink {
  a: HTMLAnchorElement;
  path: string;
  frag: string;
}

async function resolveLinks(article: HTMLElement, baseId: string): Promise<void> {
  const internal: PendingDocLink[] = [];
  // The selector only matches anchors; the checker stops at Element.
  // Skip anything inside a mounted component. Rewriting an href there would be
  // undone by the component's next update, and the listeners attached here would
  // outlive the node they were bound to. A component that renders links is
  // responsible for its own routing.
  const anchors = [...article.querySelectorAll('a[href]')].filter(a => !a.closest('.wd-mounted')) as HTMLAnchorElement[];
  anchors.forEach(a => {
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
        const t = mustEl('content').querySelector('#' + cssEsc(decodeURIComponent(frag)));
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
function resolveImages(article: HTMLElement, baseId: string): void {
  article.querySelectorAll('img[src]').forEach(img => {
    if (img.closest('.wd-mounted')) return;   // Svelte's DOM; see resolveLinks
    const src = img.getAttribute('src');
    if (!src) return;                         // the img[src] selector above is what guarantees this
    const url = resolveResourceUrl(baseId, src);
    if (url) img.setAttribute('src', url);
  });
}


// Highlight the TOC entry whose heading is in view (an IntersectionObserver over the
// content pane). One observer at a time; rebuilt for each rendered document.
let spyObserver: IntersectionObserver | null = null;
function setupScrollSpy(article: HTMLElement, tocList: HTMLElement): void {
  if (spyObserver) spyObserver.disconnect();
  const links = new Map<string, HTMLAnchorElement>();
  const tocLinks = tocList.querySelectorAll<HTMLAnchorElement>('a[data-target]');
  // The `a[data-target]` selector is what guarantees the dataset entry is there.
  tocLinks.forEach(a => { const target = a.dataset.target; if (target !== undefined) links.set(target, a); });
  // Held in a const as well as the module-level handle: the observe() loop below
  // runs inside a callback, where the compiler can no longer see that the
  // module-level `spyObserver` is the one just assigned.
  const observer = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) {
        tocList.querySelectorAll('a.active').forEach(a => a.classList.remove('active'));
        const a = links.get(e.target.id);
        if (a) a.classList.add('active');
      }
    }
  }, { root: mustEl('content'), rootMargin: '-8% 0px -80% 0px', threshold: 0 });
  spyObserver = observer;
  article.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => observer.observe(h));
}

// ---- In-document search (highlight + jump) --------------------------------
/**
 * Wire the in-document search box: on every input, clear the previous highlights
 * and, once the query reaches 2 characters, highlight all matches in the currently
 * rendered article and smooth-scroll to the first one.
 */
export function setupDocSearch(): void {
  const input = mustEl('docSearch') as HTMLInputElement;
  input.addEventListener('input', () => {
    const article = mustEl('content').querySelector<HTMLElement>('.doc');
    if (!article) return;
    clearHighlights(article);
    const q = input.value.trim();
    if (q.length < 2) return;
    const first = highlight(article, q);
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}
function clearHighlights(root: HTMLElement): void {
  // Normalize ONLY the parents whose children were actually un-wrapped, never the
  // whole article. root.normalize() merges every adjacent text node in the
  // subtree - including inside a mounted component's DOM, where Svelte is holding
  // references to specific text nodes it expects to keep updating. Merging those
  // out from under it makes later updates land on detached nodes, and the symptom
  // is a requirement table that silently stops refreshing after someone uses
  // find-in-page.
  const touched = new Set<Node>();
  root.querySelectorAll('mark.find').forEach(m => {
    if (m.parentNode) touched.add(m.parentNode);
    m.replaceWith(document.createTextNode(m.textContent || ''));
  });
  touched.forEach(parent => parent.normalize());
}
/**
 * Wrap every case-insensitive occurrence of `q` in `root`'s text nodes (skipping
 * pre/code/mark, so previous highlights and code blocks are left alone) in a
 * <mark class="find">. Returns the first inserted mark, for scroll-into-view, or
 * null if no match.
 */
function highlight(root: HTMLElement, q: string): HTMLElement | null {
  const needle = q.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    // .wd-mounted is Svelte's territory: wrapping its text in a <mark> would be
    // reverted on the component's next update, and the un-wrap on the next
    // keystroke would then be editing nodes the component no longer owns.
    acceptNode: n => (n.parentElement && n.parentElement.closest('pre,code,mark,.wd-mounted') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  const targets: Text[] = [];
  let node: Text | null;
  // SHOW_TEXT means every node the walker hands back is a Text node, and a Text
  // node's nodeValue is always a string - the fallback is only for the compiler.
  while ((node = walker.nextNode() as Text | null)) if ((node.nodeValue || '').toLowerCase().includes(needle)) targets.push(node);
  let firstMark: HTMLElement | null = null;
  for (const text of targets) {
    const frag = document.createDocumentFragment();
    // Non-null in practice: `targets` only holds Text nodes whose nodeValue just
    // matched the needle in the walk above.
    const s = text.nodeValue || '';
    let lower = s.toLowerCase(), i = 0, idx: number;
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
