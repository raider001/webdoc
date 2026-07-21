// requirements.js - Requirements traceability (see DESIGN.html §18).
// ---------------------------------------------------------------------------
// Zero dependencies. Pure ES module, same style as the rest of the app.
//
// Three responsibilities, all reusing capabilities the app already has:
//   1. EXTRACT + INDEX - during the boot load-all pass, scan every document's
//      RAW markdown for ```requirement fenced blocks (JSON bodies) and build one
//      GLOBAL trace index (id -> node) with computed inverse links.
//   2. CARDS - a post-sanitize DOM decoration (the same hook the syntax
//      highlighter would use): replace `pre > code.language-requirement` with a
//      styled, theme-aware card whose trace chips deep-link across documents.
//   3. VIEWS - a library-wide overlay with a traceability matrix + coverage
//      dashboard, plus deep-link support (#/<docId>?req=<ID>).
//
// SECURITY: every value shown comes from author JSON and is treated as
// untrusted text. The DOM is built with createElement + textContent only;
// author strings never touch innerHTML. Setting `.id` / `dataset.*` / `.href`
// as DOM properties is injection-safe (no HTML parsing).
// ---------------------------------------------------------------------------

// ---- Global index ---------------------------------------------------------
// INDEX = { byId: Map<id, node>, order: [id...], docIds: Set<docId> }
// node  = { id, docId, fields, title, type, status, tags,
//           parents, satisfiedBy, verifiedBy, relatedTo,   // raw refs
//           children, verifies, satisfies }                // computed inverse
let INDEX = null;

function asStrArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter(x => x != null).map(x => String(x));
}

// Mirror the interim renderer's fence detection so the index and the rendered
// cards always agree on what counts as a requirement block.
function extractRequirementBlocks(body) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(/^\s*```(.*)$/);
    if (open) {
      const info = (open[1] || '').trim().split(/\s+/)[0].toLowerCase();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // consume the closing fence
      if (info === 'requirement') blocks.push(buf.join('\n'));
      continue;
    }
    i++;
  }
  return blocks;
}

function nodeFromFields(fields, docId) {
  const id = fields && fields.id != null ? String(fields.id) : '';
  return {
    id,
    docId: docId || null,
    fields: fields || {},
    title: fields && fields.title != null ? String(fields.title) : id,
    type: fields && fields.type != null ? String(fields.type) : 'requirement',
    status: fields && fields.status != null ? String(fields.status) : '',
    tags: asStrArray(fields && fields.tags),
    parents: asStrArray(fields && fields.parents),
    satisfiedBy: asStrArray(fields && fields.satisfiedBy),
    verifiedBy: asStrArray(fields && fields.verifiedBy),
    relatedTo: asStrArray(fields && fields.relatedTo),
    children: [], verifies: [], satisfies: []
  };
}

// Build the one global index from the already-loaded document bodies.
export function buildRequirementIndex(docs) {
  const byId = new Map();
  const order = [];
  const docIds = new Set((docs || []).map(d => d.id));

  for (const doc of docs || []) {
    for (const raw of extractRequirementBlocks(doc.body)) {
      let fields;
      try {
        fields = JSON.parse(raw);
      } catch (e) {
        console.warn('[requirements] Skipping malformed requirement block in "' + doc.id +
          '": ' + (e && e.message ? e.message : e));
        continue;
      }
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        console.warn('[requirements] Requirement block in "' + doc.id + '" is not a JSON object; skipping.');
        continue;
      }
      const node = nodeFromFields(fields, doc.id);
      if (!node.id) {
        console.warn('[requirements] Requirement block in "' + doc.id + '" has no "id"; skipping.');
        continue;
      }
      if (byId.has(node.id)) {
        console.warn('[requirements] Duplicate requirement id "' + node.id + '" (defined in "' +
          byId.get(node.id).docId + '" and again in "' + doc.id + '"). Requirement ids must be ' +
          'globally unique; keeping the first.');
        continue;
      }
      byId.set(node.id, node);
      order.push(node.id);
    }
  }

  // Second pass: computed inverse links (only meaningful for req->req refs).
  for (const id of order) {
    const n = byId.get(id);
    for (const p of n.parents)      { const t = byId.get(p); if (t) t.children.push(id); }
    for (const v of n.verifiedBy)   { const t = byId.get(v); if (t) t.verifies.push(id); }
    for (const s of n.satisfiedBy)  { const t = byId.get(s); if (t) t.satisfies.push(id); }
  }

  INDEX = { byId, order, docIds };
  if (order.length) {
    console.info('[requirements] Indexed ' + order.length + ' requirement(s) across the library.');
  }
  return INDEX;
}

export function hasRequirements() {
  return !!(INDEX && INDEX.order.length);
}

// Resolve a trace target: a requirement id first, else a document id, else it
// is a dangling reference (flagged, never fatal).
function resolveRef(ref) {
  const id = String(ref);
  if (INDEX && INDEX.byId.has(id)) {
    const n = INDEX.byId.get(id);
    return { kind: 'req', id, docId: n.docId, node: n };
  }
  if (INDEX && INDEX.docIds.has(id)) return { kind: 'doc', id, docId: id };
  return { kind: 'dangling', id };
}

// ---- Card rendering (post-sanitize DOM decoration) ------------------------

// Called from renderDoc AFTER sanitize + numbering. Replaces every requirement
// fenced block with a card built from trusted, parsed data.
export function renderRequirements(rootEl) {
  if (!rootEl) return;
  const codes = rootEl.querySelectorAll('pre > code.language-requirement');
  codes.forEach(code => {
    const pre = code.parentElement;
    if (!pre) return;
    let fields;
    try {
      fields = JSON.parse(code.textContent);
    } catch (e) {
      // Robust to malformed JSON: leave the raw block visible, flag it, warn.
      pre.classList.add('req-block-error');
      pre.setAttribute('title', 'Malformed requirement JSON: ' + (e && e.message ? e.message : e));
      console.warn('[requirements] Malformed requirement block on the current page: ' +
        (e && e.message ? e.message : e));
      return;
    }
    const id = fields && fields.id != null ? String(fields.id) : '';
    // Prefer the indexed node (it carries the computed inverse links).
    const node = (id && INDEX && INDEX.byId.get(id)) || nodeFromFields(fields, null);
    pre.replaceWith(buildCard(node));
  });
}

function buildCard(node) {
  const card = document.createElement('section');
  card.className = 'req-card';
  card.dataset.reqId = node.id;                 // safe (property assignment)
  if (node.id) card.id = 'req-' + node.id;      // safe; used as an anchor target
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Requirement ' + node.id +
    (node.title ? ': ' + node.title : ''));

  // Header: id badge + pills
  const head = document.createElement('div');
  head.className = 'req-head';

  const badge = document.createElement('span');
  badge.className = 'req-id';
  badge.textContent = node.id || '(no id)';
  head.appendChild(badge);

  const pills = document.createElement('span');
  pills.className = 'req-pills';
  if (node.type) {
    const t = document.createElement('span');
    t.className = 'req-pill req-pill-type';
    t.dataset.type = node.type.toLowerCase();
    t.textContent = node.type;
    pills.appendChild(t);
  }
  if (node.status) {
    const s = document.createElement('span');
    s.className = 'req-pill req-pill-status';
    s.dataset.status = node.status.toLowerCase();
    s.textContent = node.status;
    pills.appendChild(s);
  }
  head.appendChild(pills);
  card.appendChild(head);

  // Title
  const title = document.createElement('p');
  title.className = 'req-title';
  title.textContent = node.title || node.id;
  card.appendChild(title);

  // Tags
  if (node.tags.length) {
    const tagRow = document.createElement('div');
    tagRow.className = 'req-tags';
    for (const tag of node.tags) {
      const tg = document.createElement('span');
      tg.className = 'req-tag';
      tg.textContent = tag;
      tagRow.appendChild(tg);
    }
    card.appendChild(tagRow);
  }

  // Trace-chip rows. sourceDocId decides same-doc vs cross-doc for each chip.
  const src = node.docId;
  const rows = document.createElement('div');
  rows.className = 'req-traces';
  addTraceRow(rows, 'Parents',      '↑', node.parents,     src);   // up arrow
  addTraceRow(rows, 'Children',     '↓', node.children,    src);   // down arrow
  addTraceRow(rows, 'Verified by',  '✓', node.verifiedBy,  src);   // check
  addTraceRow(rows, 'Satisfied by', '▣', node.satisfiedBy, src);   // filled square
  // Inverse links - populated for test / design requirements; only shown if present.
  addTraceRow(rows, 'Verifies',     '✓', node.verifies,    src);
  addTraceRow(rows, 'Satisfies',    '▣', node.satisfies,   src);
  addTraceRow(rows, 'Related',      '↔', node.relatedTo,   src);   // left-right arrow
  if (rows.childElementCount) card.appendChild(rows);

  return card;
}

function addTraceRow(container, label, symbol, refs, sourceDocId) {
  if (!refs || !refs.length) return;
  const row = document.createElement('div');
  row.className = 'req-trace-row';

  const cap = document.createElement('span');
  cap.className = 'req-trace-cap';
  cap.textContent = symbol + ' ' + label;
  row.appendChild(cap);

  const chips = document.createElement('span');
  chips.className = 'req-chips';
  for (const ref of refs) chips.appendChild(buildChip(ref, sourceDocId));
  row.appendChild(chips);

  container.appendChild(row);
}

// A trace chip. Same-doc requirement -> in-page scroll; other-doc requirement
// -> deep link; document target -> open that document; dangling -> flagged,
// non-clickable, with a tooltip.
function buildChip(ref, sourceDocId) {
  const r = resolveRef(ref);

  if (r.kind === 'dangling') {
    const span = document.createElement('span');
    span.className = 'req-chip req-chip-dangling';
    span.textContent = '⚠ ' + r.id;           // warning sign
    span.title = 'Dangling reference: “' + r.id +
      '” does not resolve to a known requirement or document.';
    span.setAttribute('role', 'note');
    return span;
  }

  const a = document.createElement('a');
  a.className = 'req-chip';
  a.textContent = r.id;

  if (r.kind === 'doc') {
    a.classList.add('req-chip-doc');
    a.href = '#/' + r.docId;
    a.title = 'Document: ' + r.id;
    return a;
  }

  // requirement target
  a.title = r.node.title ? (r.id + ' — ' + r.node.title) : r.id;
  const sameDoc = sourceDocId && r.docId && r.docId === sourceDocId;
  const target = r.docId + '?req=' + encodeURIComponent(r.id);
  a.href = '#/' + target;

  if (sameDoc) {
    // Scroll within the current page without a full re-render; keep the URL
    // copyable via replaceState (does not fire hashchange, so no re-route).
    a.addEventListener('click', ev => {
      ev.preventDefault();
      try { history.replaceState(null, '', '#/' + target); } catch (e) {}
      revealRequirement(r.id);
    });
  }
  // Cross-doc chips fall through to the normal hash router.
  return a;
}

// ---- Deep-link reveal ------------------------------------------------------
// Scroll a requirement's card into view and briefly highlight it.
export function revealRequirement(reqId) {
  if (!reqId) return;
  const root = document.getElementById('content');
  if (!root) return;
  let target = null;
  root.querySelectorAll('[data-req-id]').forEach(el => {
    if (el.dataset.reqId === reqId) target = el;
  });
  if (!target) return;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.remove('req-flash');
  void target.offsetWidth;            // restart the animation if re-triggered
  target.classList.add('req-flash');
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  window.setTimeout(() => target.classList.remove('req-flash'), 2200);
}

// Parse a requirement id out of a hash query string ("req=FR-012").
export function reqFromQuery(query) {
  if (!query) return null;
  try {
    return new URLSearchParams(query).get('req');
  } catch (e) {
    const m = String(query).match(/(?:^|&)req=([^&]*)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
}

// ---- Coverage statistics ---------------------------------------------------
function computeStats() {
  const nodes = INDEX ? INDEX.order.map(id => INDEX.byId.get(id)) : [];
  const total = nodes.length;
  let verified = 0, satisfied = 0, orphans = 0, dangling = 0;
  const statusCounts = {};
  const typeCounts = {};
  const leavesNoVerif = [];

  for (const n of nodes) {
    if (n.verifiedBy.length) verified++;
    if (n.satisfiedBy.length) satisfied++;
    if (!n.parents.length) orphans++;
    const st = n.status || '—';
    statusCounts[st] = (statusCounts[st] || 0) + 1;
    const ty = n.type || '—';
    typeCounts[ty] = (typeCounts[ty] || 0) + 1;
    for (const ref of [].concat(n.parents, n.satisfiedBy, n.verifiedBy, n.relatedTo)) {
      if (resolveRef(ref).kind === 'dangling') dangling++;
    }
    // A leaf (no children) that is not itself a test and lacks verification.
    if (!n.children.length && n.type.toLowerCase() !== 'test' && !n.verifiedBy.length) {
      leavesNoVerif.push(n.id);
    }
  }

  const pct = (num) => total ? Math.round((num / total) * 100) : 0;
  return {
    total, verified, satisfied, orphans, dangling,
    pctVerified: pct(verified), pctSatisfied: pct(satisfied),
    statusCounts, typeCounts, leavesNoVerif
  };
}

// ---- Requirements view (overlay: matrix + coverage dashboard) -------------
export function setupRequirementsView(opts) {
  opts = opts || {};
  const navigate = opts.navigate || function () {};
  const btn = document.getElementById('reqBtn');
  if (!btn) return;

  // Hide the entry point entirely when the library has no requirements.
  if (!hasRequirements()) { btn.hidden = true; return; }
  btn.hidden = false;

  const overlay = document.createElement('div');
  overlay.className = 'req-overlay';
  overlay.id = 'reqOverlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Requirements traceability');
  document.body.appendChild(overlay);

  let lastFocus = null;

  const goto = (idWithQuery) => { close(); navigate(idWithQuery); };

  const open = () => {
    lastFocus = document.activeElement;
    overlay.textContent = '';
    overlay.appendChild(buildView(goto));
    overlay.hidden = false;
    btn.setAttribute('aria-pressed', 'true');
    const closeBtn = overlay.querySelector('#reqClose');
    if (closeBtn) closeBtn.focus();
    const live = document.getElementById('live');
    if (live) live.textContent = 'Opened requirements traceability. Press Escape to close.';
  };
  const close = () => {
    if (overlay.hidden) return;
    overlay.hidden = true;
    btn.setAttribute('aria-pressed', 'false');
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    else btn.focus();
  };

  btn.addEventListener('click', () => (overlay.hidden ? open() : close()));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay.hidden) { close(); }
  });

  return { open, close };
}

function buildView(goto) {
  const view = document.createElement('div');
  view.className = 'req-view';

  // Head
  const head = document.createElement('div');
  head.className = 'req-view-head';
  const h = document.createElement('h2');
  h.className = 'req-view-title';
  h.textContent = 'Requirements traceability';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'icon-btn';
  closeBtn.id = 'reqClose';
  closeBtn.setAttribute('aria-label', 'Close requirements view');
  closeBtn.textContent = '✕';
  head.appendChild(h);
  head.appendChild(closeBtn);
  view.appendChild(head);
  // The overlay owner wires Escape; also close on the button here.
  closeBtn.addEventListener('click', () => {
    const ov = document.getElementById('reqOverlay');
    const btn = document.getElementById('reqBtn');
    if (ov) ov.hidden = true;
    if (btn) { btn.setAttribute('aria-pressed', 'false'); btn.focus(); }
  });

  view.appendChild(buildDashboard());
  view.appendChild(buildMatrix(goto));
  return view;
}

function statCard(label, value, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'req-stat' + (opts.warn ? ' req-stat-warn' : '');
  const v = document.createElement('div');
  v.className = 'req-stat-value';
  v.textContent = String(value);
  const l = document.createElement('div');
  l.className = 'req-stat-label';
  l.textContent = label;
  el.appendChild(v);
  el.appendChild(l);
  if (opts.hint) el.title = opts.hint;
  return el;
}

function buildDashboard() {
  const s = computeStats();
  const wrap = document.createElement('div');
  wrap.className = 'req-dashboard';

  const grid = document.createElement('div');
  grid.className = 'req-stats';
  grid.appendChild(statCard('requirements', s.total));
  grid.appendChild(statCard('% verified', s.pctVerified + '%',
    { hint: s.verified + ' of ' + s.total + ' have a verification' }));
  grid.appendChild(statCard('% satisfied', s.pctSatisfied + '%',
    { hint: s.satisfied + ' of ' + s.total + ' have a satisfier' }));
  grid.appendChild(statCard('orphans', s.orphans, { hint: 'Requirements with no parent' }));
  grid.appendChild(statCard('unverified leaves', s.leavesNoVerif.length,
    { warn: s.leavesNoVerif.length > 0, hint: 'Leaf requirements (no children, non-test) lacking verification' }));
  grid.appendChild(statCard('dangling refs', s.dangling,
    { warn: s.dangling > 0, hint: 'Trace targets that resolve to neither a requirement nor a document' }));
  wrap.appendChild(grid);

  // Status breakdown
  const brk = document.createElement('div');
  brk.className = 'req-breakdown';
  const cap = document.createElement('span');
  cap.className = 'req-breakdown-cap';
  cap.textContent = 'Status';
  brk.appendChild(cap);
  Object.keys(s.statusCounts).sort().forEach(st => {
    const chip = document.createElement('span');
    chip.className = 'req-pill req-pill-status';
    chip.dataset.status = st.toLowerCase();
    chip.textContent = st + ' · ' + s.statusCounts[st];
    brk.appendChild(chip);
  });
  wrap.appendChild(brk);

  return wrap;
}

function distinct(getter) {
  const set = new Set();
  if (INDEX) for (const id of INDEX.order) {
    const vals = getter(INDEX.byId.get(id));
    (Array.isArray(vals) ? vals : [vals]).forEach(v => { if (v) set.add(v); });
  }
  return Array.from(set).sort();
}

function buildMatrix(goto) {
  const wrap = document.createElement('div');
  wrap.className = 'req-matrix-wrap';

  // Filters
  const filters = document.createElement('div');
  filters.className = 'req-filters';
  const typeSel = labelledSelect(filters, 'Type', distinct(n => n.type));
  const statusSel = labelledSelect(filters, 'Status', distinct(n => n.status));
  const tagSel = labelledSelect(filters, 'Tag', distinct(n => n.tags));
  wrap.appendChild(filters);

  // Table
  const scroller = document.createElement('div');
  scroller.className = 'req-matrix-scroll';
  const table = document.createElement('table');
  table.className = 'req-matrix';

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  ['Requirement', 'Type', 'Status', 'Parents', 'Verified by', 'Satisfied by'].forEach(t => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = t;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  scroller.appendChild(table);
  wrap.appendChild(scroller);

  const empty = document.createElement('p');
  empty.className = 'req-matrix-empty';
  empty.textContent = 'No requirements match the current filters.';
  empty.hidden = true;
  wrap.appendChild(empty);

  const render = () => {
    tbody.textContent = '';
    const tf = typeSel.value, sf = statusSel.value, gf = tagSel.value;
    let shown = 0;
    for (const id of INDEX.order) {
      const n = INDEX.byId.get(id);
      if (tf && n.type !== tf) continue;
      if (sf && n.status !== sf) continue;
      if (gf && !n.tags.includes(gf)) continue;
      tbody.appendChild(buildMatrixRow(n, goto));
      shown++;
    }
    empty.hidden = shown > 0;
  };
  typeSel.addEventListener('change', render);
  statusSel.addEventListener('change', render);
  tagSel.addEventListener('change', render);
  render();

  return wrap;
}

function labelledSelect(container, labelText, options) {
  const lab = document.createElement('label');
  lab.className = 'req-filter';
  const span = document.createElement('span');
  span.textContent = labelText;
  const sel = document.createElement('select');
  const any = document.createElement('option');
  any.value = '';
  any.textContent = 'All';
  sel.appendChild(any);
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    sel.appendChild(opt);
  }
  lab.appendChild(span);
  lab.appendChild(sel);
  container.appendChild(lab);
  return sel;
}

function buildMatrixRow(n, goto) {
  const tr = document.createElement('tr');

  // Requirement (id + title) - clickable, deep-links to the card
  const idCell = document.createElement('td');
  idCell.className = 'req-cell-id';
  const link = document.createElement('a');
  link.className = 'req-matrix-link';
  link.href = '#/' + n.docId + '?req=' + encodeURIComponent(n.id);
  const badge = document.createElement('span');
  badge.className = 'req-id';
  badge.textContent = n.id;
  const ttl = document.createElement('span');
  ttl.className = 'req-matrix-title';
  ttl.textContent = n.title || '';
  link.appendChild(badge);
  link.appendChild(ttl);
  link.addEventListener('click', ev => {
    ev.preventDefault();
    goto(n.docId + '?req=' + encodeURIComponent(n.id));
  });
  idCell.appendChild(link);
  tr.appendChild(idCell);

  // Type
  const typeCell = document.createElement('td');
  if (n.type) {
    const p = document.createElement('span');
    p.className = 'req-pill req-pill-type';
    p.dataset.type = n.type.toLowerCase();
    p.textContent = n.type;
    typeCell.appendChild(p);
  }
  tr.appendChild(typeCell);

  // Status
  const statusCell = document.createElement('td');
  if (n.status) {
    const p = document.createElement('span');
    p.className = 'req-pill req-pill-status';
    p.dataset.status = n.status.toLowerCase();
    p.textContent = n.status;
    statusCell.appendChild(p);
  }
  tr.appendChild(statusCell);

  // Parents
  tr.appendChild(chipCell(n.parents, goto, false));

  // Verified by - gap highlight for an unverified LEAF (no children, non-test);
  // higher-level requirements are verified indirectly via their children.
  const isTest = n.type.toLowerCase() === 'test';
  const isGap = !isTest && n.verifiedBy.length === 0 && n.children.length === 0;
  tr.appendChild(chipCell(n.verifiedBy, goto, isGap));

  // Satisfied by
  tr.appendChild(chipCell(n.satisfiedBy, goto, false));

  return tr;
}

function chipCell(refs, goto, isGap) {
  const td = document.createElement('td');
  if (isGap) {
    td.className = 'req-gap';
    const g = document.createElement('span');
    g.className = 'req-gap-label';
    g.textContent = 'gap';
    g.title = 'Coverage gap: no verification';
    td.appendChild(g);
    return td;
  }
  if (!refs || !refs.length) {
    td.className = 'req-cell-empty';
    td.textContent = '—';
    return td;
  }
  for (const ref of refs) td.appendChild(overlayChip(ref, goto));
  return td;
}

function overlayChip(ref, goto) {
  const r = resolveRef(ref);
  if (r.kind === 'dangling') {
    const span = document.createElement('span');
    span.className = 'req-chip req-chip-dangling';
    span.textContent = '⚠ ' + r.id;
    span.title = 'Dangling reference: “' + r.id + '” does not resolve.';
    return span;
  }
  const a = document.createElement('a');
  a.className = 'req-chip';
  a.textContent = r.id;
  if (r.kind === 'doc') {
    a.classList.add('req-chip-doc');
    a.href = '#/' + r.docId;
    a.title = 'Document: ' + r.id;
    a.addEventListener('click', ev => { ev.preventDefault(); goto(r.docId); });
  } else {
    a.href = '#/' + r.docId + '?req=' + encodeURIComponent(r.id);
    a.title = r.node.title ? (r.id + ' — ' + r.node.title) : r.id;
    a.addEventListener('click', ev => {
      ev.preventDefault();
      goto(r.docId + '?req=' + encodeURIComponent(r.id));
    });
  }
  return a;
}
