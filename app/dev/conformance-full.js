// conformance-full.js - driver for the FULL official spec.json conformance run.
// ---------------------------------------------------------------------------
// The markup is app/dev/conformance-full.html; this is the script that used to
// live inline inside it. Moved out for the same reason as conformance.js: under
// serve.py's real CSP ("script-src 'self' <index.html hashes>", no
// 'unsafe-inline') an inline module never executes, and tests/test_conformance.py
// would wait for data-done on a page that had run nothing at all.
// Still type="module": it imports the engine straight from /js/commonmark.js.
import { errorMessage } from '/js/errors.js';
import { renderMarkdown } from '/js/commonmark.js';
/**
 * Resolve an element this harness's own page declares.
 *
 * Throws rather than returning null: every id passed here is written in the
 * sibling .html file, so an absent one is a broken harness, not a runtime
 * condition to handle. Failing loudly at the first lookup beats threading a
 * null through forty call sites - and beats a non-null assertion at each one.
 */
function $(id) {
    const node = document.getElementById(id);
    if (!node)
        throw new Error('harness: #' + id + ' is missing from the page');
    return node;
}
$('themeToggle').addEventListener('click', () => {
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
// (Copied verbatim from app/dev/conformance.html so both harnesses judge
//  parser output by an identical standard.)
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
function fail(msg) {
    $('status').textContent = msg;
    const s = $('summary');
    s.textContent = 'ERROR';
    s.className = 'bad';
    document.body.setAttribute('data-error', msg);
    document.body.setAttribute('data-done', '1');
}
async function run() {
    let spec;
    try {
        const res = await fetch('/dev/commonmark-spec.json', { cache: 'no-store' });
        if (!res.ok)
            throw new Error('HTTP ' + res.status);
        spec = await res.json();
    }
    catch (e) {
        return fail('Could not load /dev/commonmark-spec.json (' + errorMessage(e) + '). ' +
            'Is the static server running and was the spec fetched?');
    }
    const cases = spec.filter(c => c && typeof c.markdown === 'string' && typeof c.html === 'string');
    const failures = $('failures');
    // Per-section tally: section -> { total, pass, fail }
    const sections = new Map();
    const order = []; // preserve first-seen section order (== spec order)
    let pass = 0;
    for (const c of cases) {
        const section = c.section || '(no section)';
        if (!sections.has(section)) {
            sections.set(section, { total: 0, pass: 0, fail: 0 });
            order.push(section);
        }
        // Seeded on the line above when absent, so this is always present.
        const bucket = sections.get(section);
        bucket.total++;
        let actual;
        try {
            actual = renderMarkdown(c.markdown);
        }
        catch (e) {
            actual = 'THREW: ' + errorMessage(e) + '\n' + (e instanceof Error && e.stack ? e.stack : '');
        }
        const expN = normalizeHtml(c.html);
        const actN = normalizeHtml(actual);
        if (expN === actN) {
            pass++;
            bucket.pass++;
            continue;
        }
        bucket.fail++;
        const li = document.createElement('li');
        li.className = 'case';
        const head = document.createElement('div');
        head.className = 'case-head';
        const sec = document.createElement('span');
        sec.className = 'sec';
        sec.textContent = section;
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
    // Build the per-section summary table (spec order).
    const table = document.createElement('table');
    table.className = 'sections';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Section</th><th class="num">Pass</th>' +
        '<th class="num">Fail</th><th class="num">Total</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    const sectionReport = {};
    for (const name of order) {
        // `order` only ever receives a name that was just put into `sections`.
        const b = sections.get(name);
        sectionReport[name] = { pass: b.pass, fail: b.fail, total: b.total };
        const tr = document.createElement('tr');
        tr.className = b.fail === 0 ? 'clean' : 'dirty';
        const td = (txt, cls) => { const d = document.createElement('td'); if (cls)
            d.className = cls; d.textContent = txt; return d; };
        tr.appendChild(td(name));
        tr.appendChild(td(String(b.pass), 'num'));
        tr.appendChild(td(String(b.fail), 'num fail'));
        tr.appendChild(td(String(b.total), 'num'));
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    $('sectionTableWrap').appendChild(table);
    $('secHead').hidden = false;
    const summary = $('summary');
    const pct = total ? (100 * pass / total).toFixed(2) : '0.00';
    summary.textContent = 'PASS ' + pass + ' / ' + total + '  (' + pct + '%)';
    summary.className = pass === total ? 'ok' : 'bad';
    $('status').innerHTML = '';
    const statusLine = document.createElement('span');
    statusLine.innerHTML = 'Ran <strong>' + total + '</strong> official examples across <strong>' +
        order.length + '</strong> sections.';
    $('status').appendChild(statusLine);
    if (pass === total) {
        const ok = document.createElement('p');
        ok.className = 'empty';
        ok.textContent = 'Full CommonMark compliance: every official example passes.';
        $('status').appendChild(ok);
    }
    else {
        $('failHead').hidden = false;
    }
    // Machine-readable hooks for the Playwright test.
    document.body.setAttribute('data-pass', String(pass));
    document.body.setAttribute('data-total', String(total));
    document.body.setAttribute('data-sections', JSON.stringify(sectionReport));
    document.body.setAttribute('data-done', '1');
}
run();
