// requirements/render.ts - swap the fenced `reqgroup` placeholders that survived
// sanitize for the components that draw a requirement group or a test case, and
// keep the two Markdown-to-fragment helpers those components render prose with.
//
// FROM PHASE 6 THIS FILE BUILDS NO TABLES. It used to hand-build every row, cell,
// badge and link with elem(); app/svelte/ReqTable.svelte and
// app/svelte/TestCase.svelte own that markup now. What is left here is the SEAM:
// find the placeholder, put a `.wd-mounted` host in its place, mount the right
// component into it, and register the teardown so the next navigation destroys
// it. The placeholder pass itself (parse.js's preprocessRequirements) is
// untouched - it is a pure string-to-string rewrite of raw Markdown, runs before
// the parser, and knows nothing about any of this.
//
// blockMarkdown / inlineMarkdown STAY HERE, and stay vanilla. They are the
// document's prose: commonmark -> app/js/sanitize.js -> DocumentFragment, with
// the sanitizer as the one and only producer of trusted markup in the product.
// The components inject what they return through `use:fragment` rather than
// rendering it themselves, so the result is ordinary DOM that reader.js's block
// renderers and the syntax highlighter can go on mutating afterwards.
// ---------------------------------------------------------------------------
import { elem } from '../dom.js';
import { app } from '../app-shell.js';
import { renderInline, renderMarkdown } from '../commonmark.js';
import { sanitizeToFragment } from '../sanitize.js';
import { groupsByDoc } from './store.js';
import { loadIslands, loadedIslands } from '../islands.js';
/**
 * INLINE markdown (code / emphasis / links, no block constructs) -> sanitized
 * fragment. For single-line contexts like a requirement description.
 */
export function inlineMarkdown(text) {
    return sanitizeToFragment(renderInline(String(text == null ? '' : text)));
}
/**
 * FULL markdown (paragraphs, lists, code blocks, ...) -> sanitized fragment. Test
 * steps are structured data now, so their action / expected may be any markdown.
 */
export function blockMarkdown(text) {
    return sanitizeToFragment(renderMarkdown(String(text == null ? '' : text)));
}
/**
 * Mount every pending block, then APPLY THE RESULT SYNCHRONOUSLY.
 *
 * The flush is the non-obvious half. main.js resolves a `?req=<ID>` deep link
 * inside a single requestAnimationFrame after route() returns, by
 * document.getElementById('req-' + id) - so every row has to be in the document
 * by the end of this tick. Anything Svelte defers to a microtask lands after
 * that frame, and the deep link then fails with no error, no warning and a page
 * that simply did not scroll. tests/test_coverage_ui.py has the deep-link test
 * that catches it.
 */
function mountBlocks(mod, pending) {
    for (const { host, block } of pending) {
        // The article was replaced before the bundle arrived (only reachable on the
        // asynchronous path below). Mounting into a detached host would start
        // effects nothing will ever stop: the teardown for THIS article has already
        // run, so registering now would only add a leak to the registry.
        if (!host.isConnected)
            continue;
        const instance = block.kind === 'test'
            ? mod.mountTestCase(host, block)
            : mod.mountReqTable(host, block);
        // Through the registry, not an import: reader.js imports requirements.js,
        // which re-exports this file, so importing reader.js back would close a
        // cycle. main.js publishes registerMounted for exactly this. The guard is
        // for a shell that never booted (a harness) - a missed registration costs a
        // leak, a thrown TypeError costs the whole document.
        if (app.registerMounted)
            app.registerMounted(host, instance.destroy);
    }
    mod.flushSync();
}
/**
 * Replace each reqgroup placeholder with the component that draws it
 * (post-sanitize).
 *
 * Two-pass on purpose. The DOM swap happens for every placeholder FIRST, while
 * this function is still synchronous, so the article's shape is final before
 * anything else in renderDoc's pipeline (link resolution, block renderers, the
 * highlighter) looks at it - and so the asynchronous fallback has a stable host
 * to check `isConnected` on.
 */
export function renderRequirements(article, docId) {
    const pending = [];
    article.querySelectorAll('pre > code.language-reqgroup').forEach(code => {
        const pre = code.parentElement;
        const key = code.textContent.trim();
        const sep = key.indexOf('::');
        const dId = sep >= 0 ? key.slice(0, sep) : docId;
        const n = sep >= 0 ? parseInt(key.slice(sep + 2), 10) : 0;
        const blocks = groupsByDoc.get(dId);
        const g = blocks && blocks[n];
        if (!g) {
            pre.remove();
            return;
        }
        // `.wd-mounted` is display:contents, so the host is not a box: the figure
        // lays out exactly where the <pre> did. It is also the marker reader.js's
        // find-in-page, link resolution and image resolution use to leave this
        // subtree alone, because Svelte owns it from here on.
        const host = elem('div', 'wd-mounted');
        pre.replaceWith(host);
        pending.push({ host: host, block: g });
    });
    if (!pending.length)
        return;
    // The bundle is normally already here - boot() awaits mountShellIslands()
    // before the first route resolves - and when it is, mounting inline is what
    // keeps renderDoc synchronous end to end (see mountBlocks). The fallback is
    // for the cold case only, and accepts that a deep link into that one render
    // may not scroll; the tables themselves still appear.
    const mod = loadedIslands();
    if (mod) {
        mountBlocks(mod, pending);
        return;
    }
    loadIslands().then(m => mountBlocks(m, pending));
}
