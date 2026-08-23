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
const which = document.getElementById('which');
const show = () => { which.textContent = 'data-theme = ' + root.getAttribute('data-theme'); };
document.getElementById('toggle').addEventListener('click', () => {
    root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    show();
});
show();
