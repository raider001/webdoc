// highlight-demo.js - driver for the syntax-highlighter dev harness.
// ---------------------------------------------------------------------------
// The markup is app/dev/highlight-demo.html; this is the script that used to
// live inline inside it. Moved out because serve.py's CSP ("script-src 'self'"
// + index.html hashes, no 'unsafe-inline') blocks inline scripts, which left
// the samples unhighlighted and the theme toggle dead under the real server.
// Still type="module": it imports highlightWithin from /js/highlighter.js.
import { highlightWithin } from '/js/highlighter.js';
highlightWithin(document.body);
const root = document.documentElement;
/**
 * Resolve an element this harness's own page declares. Throws rather than
 * returning null: every id passed here is written in the sibling .html, so an
 * absent one is a broken harness, not a runtime condition to handle.
 */
function $(id) {
    const node = document.getElementById(id);
    if (!node)
        throw new Error('harness: #' + id + ' is missing from the page');
    return node;
}
const which = $('which');
const show = () => { which.textContent = 'data-theme = ' + root.getAttribute('data-theme'); };
$('toggle').addEventListener('click', () => {
    root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    show();
});
show();
