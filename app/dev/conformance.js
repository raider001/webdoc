// conformance.js - driver for the curated CommonMark conformance harness.
// ---------------------------------------------------------------------------
// The markup is app/dev/conformance.html; this is the script that used to live
// inline inside it. Moved out because serve.py's CSP is "script-src 'self'"
// plus hashes of index.html's inline scripts only - an inline module here is
// blocked and the harness silently shows "Loading corpus..." for ever.
// Still type="module": it imports the engine straight from /js/commonmark.js.
import { renderMarkdown, INTERIM } from '/js/commonmark.js';
const $ = (id) => document.getElementById(id);
document.getElementById('themeToggle').addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try {
        localStorage.setItem('wd-theme', next);
    }
    catch (e) { }
});
// CommonMark-style HTML normalization: collapse whitespace that is
// insignificant between block-level tags, while protecting <pre>/<code>
// content where whitespace is meaningful.
const BLOCK = '(?:html|head|body|address|article|aside|blockquote|details|div|dl|dt|dd|' +
    'fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|' +
    'table|tbody|td|tfoot|th|thead|tr|ul)';
function normalizeHtml(html) {
    const tokens = html.split(/(<[^>]*>)/);
    let out = '', protect = 0;
    for (const tok of tokens) {
        if (tok === '')
            continue;
        if (/^<[^>]*>$/.test(tok)) {
            const m = /^<\/?([a-zA-Z0-9]+)/.exec(tok);
            const name = m ? m[1].toLowerCase() : '';
            if (name === 'pre' || name === 'code') {
                if (tok[1] === '/')
                    protect = Math.max(0, protect - 1);
                else if (!/\/>$/.test(tok))
                    protect++;
            }
            out += tok;
        }
        else {
            out += protect > 0 ? tok : tok.replace(/\s+/g, ' ');
        }
    }
    out = out.replace(new RegExp('\\s+(</?' + BLOCK + '\\b)', 'gi'), '$1');
    out = out.replace(new RegExp('(</?' + BLOCK + '\\b[^>]*>)\\s+', 'gi'), '$1');
    return out.trim();
}
function textCell(label, value, cls) {
    const wrap = document.createElement('div');
    if (cls)
        wrap.className = cls;
    const k = document.createElement('div');
    k.className = 'k';
    k.textContent = label;
    const pre = document.createElement('pre');
    pre.className = 'code';
    pre.textContent = value;
    wrap.appendChild(k);
    wrap.appendChild(pre);
    return wrap;
}
async function run() {
    let corpus;
    try {
        const res = await fetch('/dev/corpus.json', { cache: 'no-store' });
        if (!res.ok)
            throw new Error('HTTP ' + res.status);
        corpus = await res.json();
    }
    catch (e) {
        $('status').textContent = 'Could not load /dev/corpus.json (' + e.message + '). Is serve.py running?';
        $('summary').textContent = 'ERROR';
        $('summary').className = 'bad';
        return;
    }
    const cases = corpus.filter(c => c && typeof c.markdown === 'string');
    const failures = $('failures');
    let pass = 0;
    for (const c of cases) {
        let actual;
        try {
            actual = renderMarkdown(c.markdown);
        }
        catch (e) {
            actual = 'THREW: ' + e.message + '\n' + (e.stack || '');
        }
        const expN = normalizeHtml(c.html);
        const actN = normalizeHtml(actual);
        if (expN === actN) {
            pass++;
            continue;
        }
        const li = document.createElement('li');
        li.className = 'case';
        const head = document.createElement('div');
        head.className = 'case-head';
        const sec = document.createElement('span');
        sec.className = 'sec';
        sec.textContent = c.section || '(section)';
        const ex = document.createElement('span');
        ex.className = 'ex';
        ex.textContent = 'example ' + (c.example != null ? c.example : '?');
        head.appendChild(sec);
        head.appendChild(ex);
        li.appendChild(head);
        const grid = document.createElement('div');
        grid.className = 'grid';
        grid.appendChild(textCell('markdown', c.markdown));
        grid.appendChild(textCell('expected (normalized)', expN, 'exp'));
        grid.appendChild(textCell('actual (normalized)', actN, 'act'));
        li.appendChild(grid);
        failures.appendChild(li);
    }
    const total = cases.length;
    const summary = $('summary');
    summary.textContent = 'PASS ' + pass + ' / ' + total;
    summary.className = pass === total ? 'ok' : 'bad';
    $('status').innerHTML = '';
    const statusLine = document.createElement('span');
    statusLine.innerHTML = 'Ran <strong>' + total + '</strong> cases. ' +
        'Engine <code>INTERIM = ' + String(INTERIM) + '</code>.';
    $('status').appendChild(statusLine);
    if (pass === total) {
        const ok = document.createElement('p');
        ok.className = 'empty';
        ok.textContent = 'All corpus cases pass.';
        $('status').appendChild(ok);
    }
    // Machine-readable hooks for external checks.
    document.body.setAttribute('data-pass', String(pass));
    document.body.setAttribute('data-total', String(total));
    $('pass-count').textContent = String(pass);
    $('total-count').textContent = String(total);
}
run();
