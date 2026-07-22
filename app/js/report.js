// report.js - generate a self-contained, shareable Test Coverage Report.
// ---------------------------------------------------------------------------
// Produces a single standalone HTML document (inline CSS, no scripts, no
// external assets, zero third-party) that can be downloaded and opened or
// emailed anywhere - it does not need the WebDocs server or app to view.
// All embedded content is HTML-escaped, so authored text can never inject
// markup into the report.
// ---------------------------------------------------------------------------

import { renderInline, renderMarkdown } from './commonmark.js';
import { sanitizeToFragment } from './sanitize.js';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
// Markdown as a SANITIZED HTML string, safe to embed in the standalone report.
function mdInline(text) {
  const d = document.createElement('div');
  d.appendChild(sanitizeToFragment(renderInline(String(text == null ? '' : text))));
  return d.innerHTML;
}
function mdBlock(text) {
  const d = document.createElement('div');
  d.appendChild(sanitizeToFragment(renderMarkdown(String(text == null ? '' : text))));
  return d.innerHTML;
}
// A test case's steps are [{action, expected}] — render each action + expected as
// full markdown (the steps are structured data now, not table cells).
function stepsCell(steps) {
  if (!Array.isArray(steps) || !steps.length) return '<span class="muted">&mdash;</span>';
  return '<ol class="rsteps">' + steps.map(s =>
    '<li><div class="tc-md">' + mdBlock(s.action) + '</div>' +
    (s.expected ? '<div class="rstep-e tc-md">&rarr; ' + mdBlock(s.expected) + '</div>' : '') + '</li>'
  ).join('') + '</ol>';
}
function fmtWhen(at) {
  if (!at) return '';
  try { const d = new Date(at); if (!isNaN(d.getTime())) return d.toLocaleString(); } catch (e) {}
  return String(at);
}
const LABEL = { pass: 'Pass', fail: 'Fail', partial: 'Partial', untested: 'Untested' };
function pill(status) {
  const st = status || 'untested';
  return '<span class="pill pill-' + st + '">' + esc(LABEL[st] || st) + '</span>';
}
function statusOf(map, id) {
  if (!map) return null;
  return map.get ? map.get(id) : map[id];
}
function refList(ids, kind) {
  if (!ids || !ids.length) return '<span class="muted">&mdash;</span>';
  return ids.map(id => '<code class="ref ref-' + kind + '">' + esc(id) + '</code>').join(' ');
}

// data: { title, generatedAt, requirements, tests, reqStatus, testStatus, detail }
//   requirements: [{ id, description, verifiedBy:[testId], ... }]
//   tests:        [{ id, name, steps, verifies:[reqId], ... }]
//   reqStatus/testStatus: Map id -> { status, pct }
//   detail:       [{ id, auto:[{name,pass,message}], manual:[{name,response,pass}], report }]
export function generateReportHtml(data) {
  const reqs = data.requirements || [];
  const tests = data.tests || [];
  const reqStatus = data.reqStatus, testStatus = data.testStatus;
  const detailById = new Map((data.detail || []).map(d => [d.id, d]));

  // ---- summary counts ----
  const rc = { pass: 0, partial: 0, fail: 0, untested: 0 };
  reqs.forEach(r => { const s = (statusOf(reqStatus, r.id) || {}).status || 'untested'; rc[s] = (rc[s] || 0) + 1; });
  const tc = { pass: 0, fail: 0, untested: 0 };
  tests.forEach(t => { const s = (statusOf(testStatus, t.id) || {}).status || 'untested'; tc[s] = (tc[s] || 0) + 1; });
  const reqTotal = reqs.length, testTotal = tests.length;
  const verifiedPct = reqTotal ? Math.round((rc.pass / reqTotal) * 100) : 0;

  function bar(counts, total, order) {
    if (!total) return '<div class="bar"><span class="seg seg-untested" style="width:100%"></span></div>';
    const segs = order.map(k => counts[k] ? '<span class="seg seg-' + k + '" style="width:' + (counts[k] / total * 100) + '%" title="' + esc(LABEL[k]) + ': ' + counts[k] + '"></span>' : '').join('');
    return '<div class="bar">' + segs + '</div>';
  }

  // ---- requirements table ----
  const reqRows = reqs.map(r => {
    const s = (statusOf(reqStatus, r.id) || {});
    const pct = (s.pct === null || s.pct === undefined) ? '' : s.pct + '%';
    return '<tr>' +
      '<td class="idc"><code>' + esc(r.id) + '</code></td>' +
      '<td>' + esc(r.description) + '</td>' +
      '<td class="nowrap">' + pill(s.status) + '</td>' +
      '<td class="num">' + esc(pct) + '</td>' +
      '<td>' + refList(r.verifiedBy, 'test') + '</td>' +
      '</tr>';
  }).join('');

  // ---- test-case table ----
  const testRows = tests.map(t => {
    const s = (statusOf(testStatus, t.id) || {});
    const d = detailById.get(t.id);
    const run = d && d.run;
    const runCell = run ? (esc(fmtWhen(run.at)) + (run.by ? '<div class="by">by ' + esc(run.by) + '</div>' : '')) : '<span class="muted">&mdash;</span>';
    return '<tr>' +
      '<td class="idc"><code>' + esc(t.id) + '</code></td>' +
      '<td>' + esc(t.name) + '</td>' +
      '<td class="steps">' + stepsCell(t.steps) + '</td>' +
      '<td class="nowrap">' + pill(s.status) + '</td>' +
      '<td class="nowrap runcell">' + runCell + '</td>' +
      '<td>' + refList(t.verifies, 'req') + '</td>' +
      '</tr>';
  }).join('');

  // ---- evidence appendix: only tests that have recorded results ----
  const evidence = tests.map(t => {
    const d = detailById.get(t.id);
    if (!d || (!d.auto.length && !d.manual.length && !d.report)) return '';
    const rows = [];
    d.auto.forEach(a => rows.push(
      '<li class="' + (a.pass ? 'ev-pass' : 'ev-fail') + '"><span class="dot">' + (a.pass ? '✓' : '✗') + '</span>' +
      '<span class="ev-kind">auto</span> ' + esc(a.name) +
      (a.message ? '<div class="ev-msg">' + esc(a.message) + '</div>' : '') + '</li>'));
    d.manual.forEach(m => rows.push(
      '<li class="' + (m.pass ? 'ev-pass' : 'ev-fail') + '"><span class="dot">' + (m.pass ? '✓' : '✗') + '</span>' +
      '<span class="ev-kind">manual</span> ' + esc(stripTags(m.name)) +
      (m.response ? '<div class="ev-msg">&rarr; ' + esc(stripTags(m.response)) + '</div>' : '') + '</li>'));
    const runLine = d.run ? '<p class="ev-run">Run' + (d.run.by ? ' by ' + esc(d.run.by) : '') + (d.run.at ? ' · ' + esc(fmtWhen(d.run.at)) : '') + '</p>' : '';
    return '<section class="ev"><h3><code>' + esc(t.id) + '</code> ' + esc(t.name) + '</h3>' + runLine +
      '<ul class="ev-list">' + rows.join('') + '</ul>' +
      (d.report ? '<p class="ev-note">' + esc(stripTags(d.report)) + '</p>' : '') + '</section>';
  }).join('');

  const genLine = data.generatedAt ? 'Generated ' + esc(data.generatedAt) : '';

  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + esc(data.title || 'Test Coverage') + ' — Test Report</title>' +
    '<style>' + CSS + '</style></head><body><main class="rpt">' +
    '<header class="rpt-head">' +
      '<div class="eyebrow">Test Coverage Report</div>' +
      '<h1>' + esc(data.title || 'Test Coverage') + '</h1>' +
      '<p class="gen">' + genLine + '</p>' +
    '</header>' +

    '<section class="cards">' +
      '<div class="card"><div class="big">' + verifiedPct + '%</div><div class="cap">Requirements verified</div>' +
        bar(rc, reqTotal, ['pass', 'partial', 'fail', 'untested']) +
        '<div class="mini">' + reqTotal + ' total · ' + rc.pass + ' pass · ' + rc.partial + ' partial · ' + rc.fail + ' fail · ' + rc.untested + ' untested</div>' +
      '</div>' +
      '<div class="card"><div class="big">' + tc.pass + '/' + testTotal + '</div><div class="cap">Test cases passing</div>' +
        bar(tc, testTotal, ['pass', 'fail', 'untested']) +
        '<div class="mini">' + testTotal + ' total · ' + tc.pass + ' pass · ' + tc.fail + ' fail · ' + tc.untested + ' untested</div>' +
      '</div>' +
    '</section>' +

    '<section><h2>Requirements <span class="count">(' + reqTotal + ')</span></h2>' +
      (reqTotal ? '<table><thead><tr><th>Requirement</th><th>Description</th><th>Status</th><th class="num">%</th><th>Verified By</th></tr></thead><tbody>' + reqRows + '</tbody></table>'
                : '<p class="muted">No requirements found.</p>') +
    '</section>' +

    '<section><h2>Test cases <span class="count">(' + testTotal + ')</span></h2>' +
      (testTotal ? '<table><thead><tr><th>Test</th><th>Name</th><th>Steps</th><th>Result</th><th>Last run</th><th>Verifies</th></tr></thead><tbody>' + testRows + '</tbody></table>'
                 : '<p class="muted">No test cases found.</p>') +
    '</section>' +

    (evidence ? '<section><h2>Evidence</h2>' + evidence + '</section>' : '') +

    '<footer class="rpt-foot">' + esc(data.title || 'WebDocs') + ' · Test Coverage Report' + (genLine ? ' · ' + genLine : '') + '</footer>' +
    '</main></body></html>';
}

function stripTags(html) {
  // Evidence text may be WYSIWYG HTML; reduce to plain text before escaping.
  return String(html || '').replace(/<[^>]*>/g, '');
}

const CSS = `
:root{--fg:#1a1f26;--muted:#5b6672;--faint:#8a95a1;--bg:#ffffff;--panel:#f6f7f9;--line:#e3e7ec;
--pass:#1f9d57;--fail:#e0413f;--partial:#c98a00;--untested:#3b7fd4;--accent:#2b6cb0;}
*{box-sizing:border-box}
body{margin:0;background:var(--panel);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.rpt{max-width:960px;margin:0 auto;padding:36px 28px 64px;background:var(--bg)}
.rpt-head{border-bottom:2px solid var(--line);padding-bottom:18px;margin-bottom:24px}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
h1{font-size:28px;margin:6px 0 4px;letter-spacing:-.01em}
.gen{color:var(--muted);font-size:13px;margin:0}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px}
.card{border:1px solid var(--line);border-radius:12px;padding:16px 18px;background:var(--panel)}
.big{font-size:34px;font-weight:800;line-height:1}
.cap{color:var(--muted);font-size:13px;margin:2px 0 12px}
.mini{color:var(--faint);font-size:12px;margin-top:8px}
.bar{display:flex;height:10px;border-radius:6px;overflow:hidden;background:var(--line)}
.seg{display:block;height:100%}
.seg-pass{background:var(--pass)}.seg-fail{background:var(--fail)}.seg-partial{background:var(--partial)}.seg-untested{background:var(--untested)}
h2{font-size:19px;margin:30px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h2 .count{color:var(--faint);font-weight:400;font-size:15px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:var(--panel);font-size:12.5px;white-space:nowrap}
tbody tr:nth-child(even){background:#fafbfc}
td.idc,td.nowrap{white-space:nowrap}
td.num{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}
td.steps{color:var(--muted)}
code{font-family:ui-monospace,"Cascadia Code",Consolas,monospace;font-size:12.5px}
.idc code{color:var(--accent);font-weight:600}
.ref{background:var(--panel);border:1px solid var(--line);border-radius:5px;padding:1px 6px;white-space:nowrap}
.muted{color:var(--faint)}
.pill{display:inline-block;font-size:11.5px;font-weight:700;border-radius:5px;padding:2px 9px;white-space:nowrap}
.pill-pass{background:color-mix(in srgb,var(--pass) 16%,#fff);color:var(--pass)}
.pill-fail{background:color-mix(in srgb,var(--fail) 16%,#fff);color:var(--fail)}
.pill-partial{background:color-mix(in srgb,var(--partial) 18%,#fff);color:var(--partial)}
.pill-untested{background:#fff;color:var(--untested);box-shadow:inset 0 0 0 1px var(--untested)}
.ev{border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:12px 0;background:var(--panel)}
.ev h3{margin:0 0 8px;font-size:14px}
.ev-list{list-style:none;margin:0;padding:0}
.ev-list li{padding:4px 0;border-bottom:1px solid var(--line);font-size:13px}
.ev-list li:last-child{border-bottom:none}
.dot{display:inline-block;width:16px;font-weight:700}
.ev-pass .dot{color:var(--pass)}.ev-fail .dot{color:var(--fail)}
.ev-kind{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);margin-right:4px}
.ev-msg{margin:2px 0 2px 16px;color:var(--fail);font-family:ui-monospace,Consolas,monospace;font-size:12px}
.ev-note{margin:8px 0 0;color:var(--muted);font-size:12.5px}
.ev-run{margin:0 0 8px;font-size:12px;color:var(--faint)}
.rsteps{margin:0;padding-left:18px;font-size:12.5px}
.rsteps li{margin:3px 0}
.rstep-e{color:var(--faint);margin-top:2px}
.tc-md>:first-child{margin-top:0}.tc-md>:last-child{margin-bottom:0}
.tc-md p{margin:4px 0}
.tc-md ul,.tc-md ol{margin:4px 0;padding-left:18px}
.tc-md pre{margin:5px 0;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px 10px;overflow-x:auto}
.tc-md code{background:var(--panel);border-radius:3px;padding:0 3px}
.tc-md pre code{background:none;padding:0}
td.runcell{font-size:12px;color:var(--muted)}
td.runcell .by{color:var(--faint);font-size:11px}
.rpt-foot{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);color:var(--faint);font-size:12px}
@media (max-width:640px){.cards{grid-template-columns:1fr}}
@media print{body{background:#fff}.rpt{max-width:none;padding:0}.card,.ev{break-inside:avoid}tr{break-inside:avoid}}
`;
