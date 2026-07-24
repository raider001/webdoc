// requirements.js - requirement groups AND test cases, with cross-document
// tracing. Two kinds of metadata-wrapped Markdown table are recognised:
//
//   <!--meta start {"requirement-group":"nav"}-->                  (requirements)
//   | requirement-no | description | trace-to |
//
//   <!--meta start {"test":"nav-tree","name":"...","verifies":["nav_1"]}-->  (a test case)
//   | action | expected response |
//
// TAGGING: every requirement id starts with  R_ , every test id starts with  T_ .
//   * Requirement id  R_{component}_{group}_{no}     e.g. R_WD_nav_1
//   * Test id         T_{component}_{key}            e.g. T_WD_nav-tree
//
// A TEST CASE is its own table: the meta header carries its id/name and the
// requirements it Verifies; each row is one step (an action + its expected
// response). Tracing is authored ON THE TEST (`verifies`); the requirement's
// "Verified By" column is the calculated inverse (a test may verify many
// requirements, and a requirement may be verified by many tests).
//
// Both are extracted from the RAW markdown pre-parse; each meta region leaves a
// fenced `reqgroup` placeholder that the parser emits as
// <pre><code class="language-reqgroup">docId::N</code>, replaced post-sanitize by
// the built table. The placeholder index N is the Nth meta block in the document,
// and extractGroups pushes exactly one entry per meta block (in order) so N stays
// aligned regardless of the mix of requirement / test / invalid blocks.
// ---------------------------------------------------------------------------

import { loadDoc } from './catalog.js';
import { renderInline, renderMarkdown } from './commonmark.js';
import { sanitizeToFragment } from './sanitize.js';

// INLINE markdown (code / emphasis / links, no block constructs) -> sanitized
// fragment. For single-line contexts like a requirement description.
export function inlineMarkdown(text) {
  return sanitizeToFragment(renderInline(String(text == null ? '' : text)));
}
// FULL markdown (paragraphs, lists, code blocks, ...) -> sanitized fragment. Test
// steps are structured data now, so their action / expected may be any markdown.
export function blockMarkdown(text) {
  return sanitizeToFragment(renderMarkdown(String(text == null ? '' : text)));
}

const index = new Map();        // requirement id -> record
const testIndex = new Map();    // test id -> record
let coverageStatus = null;      // Map id -> {status,pct}; set by the app so badges colour by status
export function setCoverageStatus(m) { coverageStatus = m; }
const groupsByDoc = new Map();  // docId -> [ block ]  (requirement group OR test case, in document order)
let componentBySource = {};

// Fresh regex each call (global-flag lastIndex safety).
function metaBlockRe() {
  return /<!--\s*meta\s+start\s*(\{[\s\S]*?\})\s*-->([\s\S]*?)<!--\s*meta\s+end\b[\s\S]*?-->/gi;
}
function cssSafe(id) { return String(id).replace(/[^A-Za-z0-9_-]/g, '-'); }
function splitRefs(raw) { return raw ? String(raw).split(',').map(s => s.trim()).filter(Boolean) : []; }

// Character ranges [start,end) that lie inside a fenced code block. A document
// that DOCUMENTS this syntax (e.g. the authoring reference, the how-to guide)
// shows a `<!--meta start … -->` / `<!--meta end … -->` pair literally inside a
// code fence; those must NOT be mistaken for real requirement/test blocks. Both
// the index build (extractGroups) and the placeholder pass (preprocessRequirements)
// skip fenced matches identically, so their Nth-block counting stays aligned.
function fencedRanges(body) {
  const ranges = [];
  let offset = 0, open = null;
  for (const line of String(body).split('\n')) {
    const start = offset, end = offset + line.length;
    if (!open) {
      const o = /^ {0,3}([`~]{3,})/.exec(line);            // opening fence (info string allowed)
      if (o) open = { ch: o[1][0], len: o[1].length, from: start };
    } else {
      const c = /^ {0,3}([`~]{3,})[ \t]*$/.exec(line);     // closing fence: bare, no info
      if (c && c[1][0] === open.ch && c[1].length >= open.len) { ranges.push([open.from, end]); open = null; }
    }
    offset = end + 1;                                       // + the consumed '\n'
  }
  if (open) ranges.push([open.from, String(body).length]); // an unterminated fence runs to the end
  return ranges;
}
function inFence(ranges, pos) {
  for (let i = 0; i < ranges.length; i++) if (pos >= ranges[i][0] && pos < ranges[i][1]) return true;
  return false;
}

// ---- table parsing --------------------------------------------------------
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { cur += s[i + 1]; i++; continue; }
    if (c === '|') { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}
function parseTable(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && l.indexOf('|') !== -1);
  if (lines.length < 2) return { header: [], rows: [] };
  const header = splitRow(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '-'));
  const rows = [];
  for (let r = 2; r < lines.length; r++) { // lines[1] is the |---| delimiter
    const cells = splitRow(lines[r]);
    const rec = {};
    header.forEach((h, i) => { rec[h] = (cells[i] || '').trim(); });
    rows.push(rec);
  }
  return { header, rows };
}
function pick(rec, names) { for (const n of names) if (rec[n] !== undefined && rec[n] !== '') return rec[n]; return ''; }

// ---- reference resolution -------------------------------------------------
function resolveIn(idx, cands) { for (const c of cands) if (idx.has(c)) return c; return null; }
// A requirement ref: full id (R_WD_nav_1), group_no (nav_1, same component), or a
// bare no (1, same group). ctx = { component, group? }.
function resolveReqRef(raw, ctx) {
  const cands = [raw, 'R_' + ctx.component + '_' + raw];
  if (ctx.group) cands.push('R_' + ctx.component + '_' + ctx.group + '_' + raw);
  return resolveIn(index, cands.map(c => c.toUpperCase())); // requirement ids are upper-case; match case-insensitively
}
// A requirement ref (short or full) -> its composed id, or null. For the app to
// match a test's `verifies` entries when linking / unlinking.
export function resolveRequirementRef(raw, component) {
  return resolveReqRef(String(raw == null ? '' : raw), { component: component });
}

// ---- extraction -----------------------------------------------------------
function extractGroups(body, doc, component) {
  const blocks = [];
  const ranges = fencedRanges(body);
  const RE = metaBlockRe();
  let m;
  while ((m = RE.exec(body)) !== null) {
    if (inFence(ranges, m.index)) continue;   // literal example in a code fence, not a real block
    let meta = null;
    try { meta = JSON.parse(m[1]); } catch (e) { /* handled below */ }
    const table = parseTable(m[2]);
    const isTest = !!(meta && (meta.test || meta['test-case']));
    blocks.push(isTest ? extractTestCase(meta, table, doc, component)
                       : extractReqGroup(meta, table, doc, component));
  }
  return blocks;
}

function extractReqGroup(meta, table, doc, component) {
  const group = meta && (meta['requirement-group'] || meta.group);
  let error = null;
  if (!component) error = "source '" + doc.source + "' has no 'component' id in the server config";
  else if (!meta) error = 'requirement-group metadata is not valid JSON';
  else if (!group) error = 'requirement-group name is missing';

  const g = { kind: 'req', group: group || '(unnamed)', component: component || '?', rows: [], error: error };
  for (const row of table.rows) {
    const no = pick(row, ['requirement-no', 'req-no', 'no', 'requirement', '#']);
    if (!no) continue;
    const id = ((component && group) ? 'R_' + component + '_' + group + '_' + no : 'R_?_' + no).toUpperCase();
    const rec = {
      id: id, docId: doc.id, component: component, group: group, no: no,
      description: pick(row, ['description', 'desc']),
      traceTo: splitRefs(pick(row, ['trace-to', 'traceto', 'trace'])),
      traceFrom: [], verifiedBy: []   // verifiedBy is CALCULATED from tests' `verifies`
    };
    // NOTE: the global index comes from the server (buildRequirementIndex); per-doc
    // extraction only builds block structure for rendering, so it does NOT populate
    // the global index here (prepareDocGroups enriches from it instead).
    g.rows.push(rec);
  }
  return g;
}

function extractTestCase(meta, table, doc, component) {
  const key = meta && (meta.test || meta['test-case']);
  let error = null;
  if (!component) error = "source '" + doc.source + "' has no 'component' id in the server config";
  else if (!meta) error = 'test-case metadata is not valid JSON';
  else if (!key) error = 'test-case key ("test") is missing';

  const id = (component && key) ? 'T_' + component + '_' + key : 'T_?_' + (key || 'x');
  // Steps are structured data in the meta header (a custom block, NOT a markdown
  // table), so each action / expected can hold arbitrary markdown - pipes,
  // backslashes, multiple lines. Older docs kept them in a table; still read those.
  let steps = [];
  if (Array.isArray(meta && meta.steps)) {
    steps = meta.steps.map(s => ({
      action: (s && s.action) || '',
      expected: (s && (s.expected || s['expected-response'] || s.response)) || ''
    })).filter(s => s.action || s.expected);
  } else {
    for (const row of table.rows) {
      const action = pick(row, ['action', 'step', 'request', 'do', 'when']);
      const expected = pick(row, ['expected-response', 'expected', 'response', 'result', 'then']);
      if (!action && !expected) continue;
      steps.push({ action: action, expected: expected });
    }
  }
  const verifiesRaw = Array.isArray(meta && meta.verifies) ? meta.verifies.map(String)
                    : splitRefs(meta && (meta.verifies || meta.verify || ''));
  const rec = {
    id: id, docId: doc.id, component: component, key: key || '',
    name: (meta && meta.name) || key || id,
    steps: steps, verifiesRaw: verifiesRaw, verifies: []
  };
  // Global test index comes from the server (see extractReqGroup note).
  return { kind: 'test', rec: rec, error: error };
}

// Build the GLOBAL requirement/test index from the server's SQLite index (composed
// ids + resolved trace-from / verified-by / verifies). This used to scan every doc
// body at boot - the wall that capped the corpus. Now the server computes it and the
// browser fetches a compact list; per-document block STRUCTURE (for the in-document
// tables) is parsed on demand from the displayed doc only (prepareDocGroups).
export async function buildRequirementIndex(docs, sources) {
  index.clear();
  testIndex.clear();
  groupsByDoc.clear();
  componentBySource = {};
  for (const s of sources || []) componentBySource[s.name] = s.component;

  let data = null;
  try {
    const res = await fetch('/api/index/coverage', { cache: 'no-cache' });
    if (res.ok) data = await res.json();
  } catch (e) { /* index unavailable -> empty (badges/map stay neutral) */ }
  if (!data) return;
  for (const r of data.requirements || []) {
    index.set(r.id, {
      id: r.id, docId: r.docId, component: r.component, group: r.group, no: r.no,
      description: r.description || '', traceTo: (r.traceTo || []).slice(),
      traceFrom: (r.traceFrom || []).slice(), verifiedBy: (r.verifiedBy || []).slice()
    });
  }
  for (const t of data.tests || []) {
    testIndex.set(t.id, {
      id: t.id, docId: t.docId, component: t.component, key: t.key, name: t.name || t.id,
      steps: t.steps || [], verifiesRaw: (t.verifies || []).slice(), verifies: (t.verifies || []).slice()
    });
  }
}

// Parse the CURRENT document's requirement/test blocks from its (already-loaded)
// body and stash them for renderRequirements, enriched with the global trace-from /
// verified-by / verifies resolved by the server. Only the displayed doc is parsed.
export function prepareDocGroups(body, docId, source) {
  const component = componentBySource[source];
  const blocks = extractGroups(String(body || ''), { id: docId, source: source }, component);
  for (const b of blocks) {
    if (b.kind === 'req') {
      for (const rec of b.rows) {
        const g = index.get(rec.id);
        if (g) { rec.traceFrom = g.traceFrom || []; rec.verifiedBy = g.verifiedBy || []; }
      }
    } else if (b.kind === 'test' && b.rec) {
      const g = testIndex.get(b.rec.id);
      if (g) b.rec.verifies = (g.verifies || []).slice();
    }
  }
  groupsByDoc.set(docId, blocks);
  return blocks;
}

// Every known requirement (for the coverage rollup and the editor picker).
export function requirementList() {
  return [...index.values()]
    .map(r => ({
      id: r.id, description: r.description || '', docId: r.docId, group: r.group,
      component: r.component, no: r.no,
      traceTo: (r.traceTo || []).slice(),
      traceFrom: (r.traceFrom || []).slice(),
      verifiedBy: (r.verifiedBy || []).slice()   // calculated test ids
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Every known test case (for the coverage rollup, graph, runner and editor).
export function testList() {
  return [...testIndex.values()]
    .map(t => ({
      id: t.id, name: t.name || '', key: t.key, docId: t.docId, component: t.component,
      steps: (t.steps || []).map(s => ({ action: s.action, expected: s.expected })),
      verifies: (t.verifies || []).slice()
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Replace each meta-wrapped region in the raw markdown with a fenced placeholder.
export function preprocessRequirements(body, docId) {
  const src = String(body);
  const ranges = fencedRanges(src);
  let n = 0;
  return src.replace(metaBlockRe(), (whole, _json, _inner, offset) => {
    if (inFence(ranges, offset)) return whole;   // leave a literal example untouched
    const key = docId + '::' + (n++);
    return '\n```reqgroup\n' + key + '\n```\n';
  });
}

// ---- rendering ------------------------------------------------------------
function reqLink(composedId) {
  const rec = index.get(composedId);
  const a = document.createElement('a');
  a.className = 'req-link';
  a.href = '#/' + rec.docId + '?req=' + encodeURIComponent(composedId);
  a.textContent = composedId;
  return a;
}
function testLink(testId) {
  const rec = testIndex.get(testId);
  const a = document.createElement('a');
  a.className = 'req-link tc-link';
  a.href = '#/' + rec.docId + '?test=' + encodeURIComponent(testId);
  a.textContent = testId;
  return a;
}
function missingChip(raw) {
  const span = document.createElement('span');
  span.className = 'req-missing';
  span.title = 'Not found: ' + raw;
  span.textContent = '⚠ ' + raw;
  return span;
}
function noneCell() { const s = document.createElement('span'); s.className = 'req-none'; s.textContent = '—'; return s; }
function fillTrace(td, nodes) {
  if (!nodes.length) { td.textContent = '—'; td.classList.add('req-none'); return; }
  nodes.forEach((node, i) => {
    td.appendChild(node);
    if (i < nodes.length - 1) td.appendChild(document.createTextNode(', '));
  });
}
function statusOf(id) {
  if (!coverageStatus) return null;
  return coverageStatus.get ? coverageStatus.get(id) : coverageStatus[id];
}
function badgeStatus(badge, id) { const s = statusOf(id); if (s) badge.classList.add('req-badge-st-' + s.status); }
function resultBadge(testId) {
  const st = (statusOf(testId) || {}).status || 'untested';
  const span = document.createElement('span');
  span.className = 'tc-result tc-result-' + st;
  span.textContent = st === 'pass' ? 'Pass' : st === 'fail' ? 'Fail' : st === 'partial' ? 'Partial' : 'Untested';
  return span;
}

function buildReqTable(g) {
  const fig = document.createElement('figure'); fig.className = 'req-group';
  const cap = document.createElement('figcaption'); cap.className = 'req-cap'; cap.textContent = 'Requirements — ' + g.group; fig.appendChild(cap);
  if (g.error) { const err = document.createElement('p'); err.className = 'req-error'; err.textContent = '⚠ ' + g.error; fig.appendChild(err); }

  const table = document.createElement('table'); table.className = 'req-tbl';
  const thead = document.createElement('thead'); const htr = document.createElement('tr');
  ['Requirement', 'Description', 'Trace To', 'Trace From', 'Verified By'].forEach(h => { const th = document.createElement('th'); th.textContent = h; htr.appendChild(th); });
  thead.appendChild(htr); table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const rec of g.rows) {
    const tr = document.createElement('tr');
    if (rec.component && rec.group) tr.id = 'req-' + cssSafe(rec.id);

    const tdId = document.createElement('td'); tdId.className = 'req-idcell';
    const badge = document.createElement('span'); badge.className = 'req-badge'; badge.textContent = rec.id;
    badgeStatus(badge, rec.id); tdId.appendChild(badge); tr.appendChild(tdId);

    const tdDesc = document.createElement('td'); tdDesc.appendChild(inlineMarkdown(rec.description)); tr.appendChild(tdDesc);

    const tdTo = document.createElement('td');
    fillTrace(tdTo, rec.traceTo.map(raw => { const t = resolveReqRef(raw, rec); return t ? reqLink(t) : missingChip(raw); }));
    tr.appendChild(tdTo);

    const tdFrom = document.createElement('td');
    fillTrace(tdFrom, rec.traceFrom.map(id => reqLink(id)));
    tr.appendChild(tdFrom);

    const tdVer = document.createElement('td');
    fillTrace(tdVer, (rec.verifiedBy || []).map(id => testLink(id)));
    tr.appendChild(tdVer);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const wrap = document.createElement('div'); wrap.className = 'req-scroll'; wrap.appendChild(table); fig.appendChild(wrap);
  return fig;
}

// A test case renders as: a caption (name + id + Result), a "Verifies" line, and
// the numbered action / expected-response step table.
function buildTestCase(block) {
  const rec = block.rec;
  const fig = document.createElement('figure'); fig.className = 'req-group test-case';
  if (rec.component && rec.key) fig.id = 'test-' + cssSafe(rec.id);

  const cap = document.createElement('figcaption'); cap.className = 'req-cap tc-cap';
  cap.appendChild(document.createTextNode('Test case — ' + rec.name + ' '));
  const idEl = document.createElement('span'); idEl.className = 'tc-id'; idEl.textContent = rec.id; cap.appendChild(idEl);
  cap.appendChild(resultBadge(rec.id));
  if (rec.component && rec.key) {
    const run = document.createElement('button'); run.type = 'button'; run.className = 'tc-run'; run.textContent = '▷ Run';
    run.title = 'Run this test case';
    run.addEventListener('click', () => document.dispatchEvent(new CustomEvent('webdoc:run-test', { detail: { testId: rec.id } })));
    cap.appendChild(run);
  }
  fig.appendChild(cap);

  if (block.error) { const err = document.createElement('p'); err.className = 'req-error'; err.textContent = '⚠ ' + block.error; fig.appendChild(err); }

  const vp = document.createElement('p'); vp.className = 'tc-verifies';
  vp.appendChild(document.createTextNode('Verifies: '));
  if (rec.verifies.length) rec.verifies.forEach((id, i) => { if (i) vp.appendChild(document.createTextNode(', ')); vp.appendChild(reqLink(id)); });
  else vp.appendChild(noneCell());
  fig.appendChild(vp);

  const table = document.createElement('table'); table.className = 'req-tbl test-steps-tbl';
  const thead = document.createElement('thead'); const htr = document.createElement('tr');
  ['#', 'Action', 'Expected response'].forEach(h => { const th = document.createElement('th'); th.textContent = h; htr.appendChild(th); });
  thead.appendChild(htr); table.appendChild(thead);
  const tbody = document.createElement('tbody');
  rec.steps.forEach((s, i) => {
    const tr = document.createElement('tr');
    const n = document.createElement('td'); n.className = 'tc-stepno'; n.textContent = String(i + 1); tr.appendChild(n);
    const a = document.createElement('td'); a.className = 'tc-md'; a.appendChild(blockMarkdown(s.action)); tr.appendChild(a);
    const e = document.createElement('td'); e.className = 'tc-steps tc-md'; e.appendChild(blockMarkdown(s.expected)); tr.appendChild(e);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const wrap = document.createElement('div'); wrap.className = 'req-scroll'; wrap.appendChild(table); fig.appendChild(wrap);
  return fig;
}

// Replace each reqgroup placeholder with its built table (post-sanitize).
export function renderRequirements(article, docId) {
  article.querySelectorAll('pre > code.language-reqgroup').forEach(code => {
    const pre = code.parentElement;
    const key = code.textContent.trim();
    const sep = key.indexOf('::');
    const dId = sep >= 0 ? key.slice(0, sep) : docId;
    const n = sep >= 0 ? parseInt(key.slice(sep + 2), 10) : 0;
    const blocks = groupsByDoc.get(dId);
    const g = blocks && blocks[n];
    if (!g) { pre.remove(); return; }
    pre.replaceWith(g.kind === 'test' ? buildTestCase(g) : buildReqTable(g));
  });
}

// Deep-link: scroll a requirement or test into view and flash it.
function reveal(prefix, id) {
  if (!id) return;
  const el = document.getElementById(prefix + cssSafe(id));
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('req-flash');
  setTimeout(() => el.classList.remove('req-flash'), 1600);
}
export function revealRequirement(reqId) { reveal('req-', reqId); }
export function revealTest(testId) { reveal('test-', testId); }

// Pull ?req=<id> / ?test=<id> out of a hash-route query string.
export function reqFromQuery(query) {
  if (!query) return null;
  const m = /(?:^|[?&])req=([^&]+)/.exec(query);
  return m ? decodeURIComponent(m[1]) : null;
}
export function testFromQuery(query) {
  if (!query) return null;
  const m = /(?:^|[?&])test=([^&]+)/.exec(query);
  return m ? decodeURIComponent(m[1]) : null;
}

// Document -> document trace edges, for the map view's requirement-trace layer.
export function requirementTraceEdges() {
  const seen = new Set();
  const edges = [];
  for (const rec of index.values()) {
    for (const raw of rec.traceTo) {
      const target = resolveReqRef(raw, rec);
      if (!target) continue;
      const toDoc = index.get(target).docId;
      if (toDoc === rec.docId) continue;
      const key = rec.docId + ' ' + toDoc;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: rec.docId, to: toDoc });
    }
  }
  return edges;
}
