// requirements.js - requirement-group tables with cross-document tracing.
// ---------------------------------------------------------------------------
// A "requirement group" is a Markdown table wrapped in paired meta comments:
//
//   <!--meta start {"requirement-group":"auth"}-->
//   | requirement-no | description        | trace-to      |
//   | -------------- | ------------------ | ------------- |
//   | 1              | The user shall ... | 2, sys_3      |
//   <!--meta end {"requirement-group":"auth"}-->
//
// It renders as a 4-column table:  Requirement | Description | Trace To | Trace From
//   * Requirement  = composed id  {component}_{group}_{no}   (component from the
//                    server config, per source; required)
//   * Trace To     = the author's `trace-to` refs, each resolved to a LINK to the
//                    target requirement's document (unresolved -> flagged warning)
//   * Trace From   = the CALCULATED inverse: every requirement that traces here.
//
// Requirement-to-requirement tracing only. No cards, no matrix, no separate view.
// The meta-comment regions are stripped by the sanitizer, so we extract them from
// the RAW markdown pre-parse and leave a fenced `reqgroup` placeholder that the
// parser turns into <pre><code class="language-reqgroup">, which we then replace
// with the built table (post-sanitize, same layering as heading numbering).
// ---------------------------------------------------------------------------

import { loadDoc } from './catalog.js';

const index = new Map();       // composedId -> record
const groupsByDoc = new Map(); // docId -> [ group ]  (group = {group, rows:[record], error})
let componentBySource = {};

// Fresh regex each call (global-flag lastIndex safety).
function metaBlockRe() {
  return /<!--\s*meta\s+start\s*(\{[\s\S]*?\})\s*-->([\s\S]*?)<!--\s*meta\s+end\b[\s\S]*?-->/gi;
}

function cssSafe(id) { return String(id).replace(/[^A-Za-z0-9_-]/g, '-'); }

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
  const rows = text.split('\n').map(l => l.trim()).filter(l => l && l.indexOf('|') !== -1);
  if (rows.length < 2) return [];
  const header = splitRow(rows[0]).map(h => h.toLowerCase().replace(/\s+/g, '-'));
  const col = names => { for (const n of names) { const i = header.indexOf(n); if (i !== -1) return i; } return -1; };
  const iNo = col(['requirement-no', 'req-no', 'no', 'requirement', '#']);
  const iDesc = col(['description', 'desc']);
  const iTrace = col(['trace-to', 'traceto', 'trace']);
  const out = [];
  for (let r = 2; r < rows.length; r++) { // rows[1] is the |---| delimiter
    const cells = splitRow(rows[r]);
    const no = (iNo >= 0 ? cells[iNo] : cells[0] || '').trim();
    if (!no) continue;
    const description = (iDesc >= 0 ? cells[iDesc] : cells[1] || '').trim();
    const traceRaw = (iTrace >= 0 ? cells[iTrace] : '').trim();
    const traceTo = traceRaw ? traceRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    out.push({ no, description, traceTo });
  }
  return out;
}

// ---- reference resolution -------------------------------------------------
// A trace-to ref is a requirement reference: the bare number (same group),
// group_no (same component), or a full composed id. Returns the composed id if
// it resolves against the index, else null.
function resolveRef(raw, ctx) {
  const cands = [raw, ctx.component + '_' + raw, ctx.component + '_' + ctx.group + '_' + raw];
  for (const c of cands) if (index.has(c)) return c;
  return null;
}

// ---- extraction -----------------------------------------------------------
function extractGroups(body, doc, component) {
  const groups = [];
  const RE = metaBlockRe();
  let m;
  while ((m = RE.exec(body)) !== null) {
    let meta = null;
    try { meta = JSON.parse(m[1]); } catch (e) { /* handled below */ }
    const group = meta && (meta['requirement-group'] || meta.group);
    const rows = parseTable(m[2]);
    let error = null;
    if (!component) error = "source '" + doc.source + "' has no 'component' id in the server config";
    else if (!meta) error = 'requirement-group metadata is not valid JSON';
    else if (!group) error = 'requirement-group name is missing';

    const g = { group: group || '(unnamed)', component: component || '?', rows: [], error: error };
    for (const row of rows) {
      const id = (component && group) ? component + '_' + group + '_' + row.no : '?_' + row.no;
      const rec = {
        id: id, docId: doc.id, component: component, group: group,
        no: row.no, description: row.description, traceTo: row.traceTo, traceFrom: []
      };
      if (component && group) {
        if (index.has(id)) console.warn('[requirements] duplicate requirement id:', id);
        index.set(id, rec);
      }
      g.rows.push(rec);
    }
    groups.push(g);
  }
  return groups;
}

// Build the global index across ALL documents (needed for trace-from). Async:
// ensures every doc's body is loaded, then computes inverse links.
export async function buildRequirementIndex(docs, sources) {
  index.clear();
  groupsByDoc.clear();
  componentBySource = {};
  for (const s of sources || []) componentBySource[s.name] = s.component;

  for (const doc of docs) {
    if (!doc._loaded) { try { await loadDoc(doc); } catch (e) { continue; } }
    const component = componentBySource[doc.source];
    const groups = extractGroups(doc.body || '', doc, component);
    if (groups.length) groupsByDoc.set(doc.id, groups);
  }

  // Calculated Trace From = inverse of every resolvable Trace To.
  for (const rec of index.values()) {
    for (const raw of rec.traceTo) {
      const target = resolveRef(raw, { component: rec.component, group: rec.group });
      if (target && index.has(target)) index.get(target).traceFrom.push(rec.id);
    }
  }
}

// Replace each meta-wrapped region in the raw markdown with a fenced placeholder
// the parser will emit as <pre><code class="language-reqgroup">docId::N</code>.
export function preprocessRequirements(body, docId) {
  let n = 0;
  return String(body).replace(metaBlockRe(), () => {
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
function missingChip(raw) {
  const span = document.createElement('span');
  span.className = 'req-missing';
  span.title = 'Requirement not found: ' + raw;
  span.textContent = '⚠ ' + raw;
  return span;
}
function fillTrace(td, nodes) {
  if (!nodes.length) { td.textContent = '—'; td.classList.add('req-none'); return; }
  nodes.forEach((node, i) => {
    td.appendChild(node);
    if (i < nodes.length - 1) td.appendChild(document.createTextNode(', '));
  });
}

function buildGroupTable(g) {
  const fig = document.createElement('figure');
  fig.className = 'req-group';

  const cap = document.createElement('figcaption');
  cap.className = 'req-cap';
  cap.textContent = 'Requirements — ' + g.group;
  fig.appendChild(cap);

  if (g.error) {
    const err = document.createElement('p');
    err.className = 'req-error';
    err.textContent = '⚠ ' + g.error;
    fig.appendChild(err);
  }

  const table = document.createElement('table');
  table.className = 'req-tbl';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  ['Requirement', 'Description', 'Trace To', 'Trace From'].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const rec of g.rows) {
    const tr = document.createElement('tr');
    if (rec.component && rec.group) tr.id = 'req-' + cssSafe(rec.id);

    const tdId = document.createElement('td');
    tdId.className = 'req-idcell';
    const badge = document.createElement('span');
    badge.className = 'req-badge';
    badge.textContent = rec.id;
    tdId.appendChild(badge);
    tr.appendChild(tdId);

    const tdDesc = document.createElement('td');
    tdDesc.textContent = rec.description;
    tr.appendChild(tdDesc);

    const tdTo = document.createElement('td');
    fillTrace(tdTo, rec.traceTo.map(raw => {
      const t = resolveRef(raw, { component: rec.component, group: rec.group });
      return t ? reqLink(t) : missingChip(raw);
    }));
    tr.appendChild(tdTo);

    const tdFrom = document.createElement('td');
    fillTrace(tdFrom, rec.traceFrom.map(id => reqLink(id)));
    tr.appendChild(tdFrom);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const wrap = document.createElement('div');
  wrap.className = 'req-scroll';
  wrap.appendChild(table);
  fig.appendChild(wrap);
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
    const groups = groupsByDoc.get(dId);
    const g = groups && groups[n];
    if (!g) { pre.remove(); return; }
    pre.replaceWith(buildGroupTable(g));
  });
}

// Deep-link: scroll a specific requirement into view and flash it.
export function revealRequirement(reqId) {
  if (!reqId) return;
  const el = document.getElementById('req-' + cssSafe(reqId));
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('req-flash');
  setTimeout(() => el.classList.remove('req-flash'), 1600);
}

// Pull the ?req=<id> value out of a hash-route query string ("?req=GUIDE_a_1").
export function reqFromQuery(query) {
  if (!query) return null;
  const m = /(?:^|[?&])req=([^&]+)/.exec(query);
  return m ? decodeURIComponent(m[1]) : null;
}

// Document -> document trace edges, for the map view's requirement-trace layer.
// Each edge {from, to} means a requirement in `from` traces to one in `to`.
export function requirementTraceEdges() {
  const seen = new Set();
  const edges = [];
  for (const rec of index.values()) {
    for (const raw of rec.traceTo) {
      const target = resolveRef(raw, { component: rec.component, group: rec.group });
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
