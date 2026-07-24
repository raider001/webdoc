// editor/widgets.js - the structured block widgets: table editor, requirement
// group, test case, and the shared reference-picker (chips + autocomplete) that
// backs both a requirement's Trace-To and a test case's Verifies.
import { smallBtn } from './ui.js';
import { editable } from './richtext.js';

/* ---- table editor ---- */
export function tableEditor(b) {
  const box = document.createElement('div'); box.className = 'blk-tablebox';
  function draw() {
    box.textContent = '';
    const t = document.createElement('table'); t.className = 'blk-table';
    const thead = document.createElement('tr');
    b.headers.forEach((h, ci) => thead.appendChild(cell(h, v => b.headers[ci] = v, true)));
    t.appendChild(thead);
    b.rows.forEach((row, ri) => {
      const tr = document.createElement('tr');
      row.forEach((c, ci) => tr.appendChild(cell(c, v => b.rows[ri][ci] = v, false)));
      t.appendChild(tr);
    });
    box.appendChild(t);
    const ctr = document.createElement('div'); ctr.className = 'blk-table-ctr';
    ctr.appendChild(smallBtn('+ Row', () => { b.rows.push(b.headers.map(() => '')); draw(); }));
    ctr.appendChild(smallBtn('+ Column', () => { b.headers.push('Column ' + (b.headers.length + 1)); b.aligns.push(''); b.rows.forEach(r => r.push('')); draw(); }));
    if (b.rows.length) ctr.appendChild(smallBtn('− Row', () => { b.rows.pop(); draw(); }));
    if (b.headers.length > 1) ctr.appendChild(smallBtn('− Column', () => { b.headers.pop(); b.aligns.pop(); b.rows.forEach(r => r.pop()); draw(); }));
    box.appendChild(ctr);
  }
  // Cells are rich text (contenteditable), so they hold inline Markdown - bold,
  // links, `code`, and images - not just plain strings. The stored cell value is
  // inline HTML; serialize.js converts each cell via htmlToMd (GFM cells accept
  // inline markdown as long as it stays on one line and pipes are escaped).
  function cell(val, onChange, head) {
    const td = document.createElement(head ? 'th' : 'td');
    td.appendChild(editable(val || '', 'tablecell', onChange, ''));
    return td;
  }
  draw();
  return box;
}

/* ---- requirement widget ---- */
export function requirementWidget(b, getReqs) {
  const box = document.createElement('div'); box.className = 'blk-reqbox';
  const gl = document.createElement('label'); gl.className = 'blk-reqgroup';
  gl.append('Requirement group ', (() => { const i = document.createElement('input'); i.value = b.group || ''; i.placeholder = 'e.g. sys'; i.addEventListener('input', () => b.group = i.value.trim()); return i; })());
  box.appendChild(gl);
  const table = document.createElement('div'); box.appendChild(table);
  function draw() {
    table.textContent = '';
    const head = document.createElement('div'); head.className = 'req-row req-head';
    head.append(span('No.'), span('Description'), span('Trace to'), span(''));
    table.appendChild(head);
    b.rows.forEach((r, i) => {
      const row = document.createElement('div'); row.className = 'req-row';
      row.appendChild(field(r.no, v => r.no = v, 'no'));
      row.appendChild(field(r.description, v => r.description = v, 'wide'));
      row.appendChild(traceToField(r, getReqs));
      row.appendChild(smallBtn('✕', () => { b.rows.splice(i, 1); if (!b.rows.length) b.rows.push({ no: '1', description: '', traceTo: '' }); draw(); }));
      table.appendChild(row);
    });
    const add = smallBtn('+ Requirement', () => { b.rows.push({ no: String(b.rows.length + 1), description: '', traceTo: '' }); draw(); });
    add.className = 'blk-req-add'; table.appendChild(add);
  }
  function field(val, onChange, cls) { const i = document.createElement('input'); i.className = 'req-f req-f-' + cls; i.value = val || ''; i.addEventListener('input', () => onChange(i.value)); return i; }
  function span(t) { const s = document.createElement('span'); s.textContent = t; return s; }
  draw();
  return box;
}

/* ---- test-case widget: key + name + Verifies picker + action/expected steps ---- */
export function testCaseWidget(b, getReqs, comp) {
  const box = document.createElement('div'); box.className = 'blk-reqbox blk-tcbox';
  function input(val, onChange, ph) { const i = document.createElement('input'); i.value = val || ''; i.placeholder = ph || ''; i.addEventListener('input', () => onChange(i.value)); return i; }
  function labeled(txt, node) { const l = document.createElement('label'); l.className = 'blk-reqgroup'; l.append(txt + ' ', node); box.appendChild(l); }
  function span(t) { const s = document.createElement('span'); s.textContent = t; return s; }
  // Multi-line markdown source field (auto-grows).
  function mdField(val, onChange, ph) {
    const t = document.createElement('textarea'); t.className = 'req-f req-f-md'; t.value = val || ''; t.rows = 1; t.placeholder = ph || '';
    const grow = () => { t.style.height = 'auto'; t.style.height = Math.max(30, t.scrollHeight) + 'px'; };
    t.addEventListener('input', () => { onChange(t.value); grow(); });
    setTimeout(grow, 0);
    return t;
  }

  labeled('Test key', input(b.key, v => { b.key = v.trim(); updatePreview(); }, 'e.g. login-valid'));
  labeled('Name', input(b.name, v => b.name = v, 'e.g. Valid login'));
  const preview = document.createElement('div'); preview.className = 'blk-tc-preview'; box.appendChild(preview);
  function updatePreview() { preview.textContent = 'id: T_' + (comp || '{component}') + '_' + (b.key || 'key'); }
  updatePreview();

  const vl = document.createElement('label'); vl.className = 'blk-reqgroup blk-tc-verifies'; vl.append('Verifies ');
  vl.appendChild(refsField(b.verifies || [], refs => b.verifies = refs, getReqs, 'requirement…'));
  box.appendChild(vl);

  const table = document.createElement('div'); box.appendChild(table);
  function draw() {
    table.textContent = '';
    const head = document.createElement('div'); head.className = 'req-row tc-erow req-head';
    head.append(span('Action'), span('Expected response'), span(''));
    table.appendChild(head);
    b.steps.forEach((s, i) => {
      const row = document.createElement('div'); row.className = 'req-row tc-erow';
      row.appendChild(mdField(s.action, v => s.action = v, 'action (markdown ok)…'));
      row.appendChild(mdField(s.expected, v => s.expected = v, 'expected response (markdown ok)…'));
      row.appendChild(smallBtn('✕', () => { b.steps.splice(i, 1); if (!b.steps.length) b.steps.push({ action: '', expected: '' }); draw(); }));
      table.appendChild(row);
    });
    const add = smallBtn('+ Step', () => { b.steps.push({ action: '', expected: '' }); draw(); }); add.className = 'blk-req-add'; table.appendChild(add);
  }
  draw();
  return box;
}

/* ---- reference picker: chips + a live autocomplete dropdown (id + description).
   Generic over the target list (requirements) so both a requirement's Trace-To and
   a test case's Verifies reuse it. ---- */
let acDrop = null, acItems = [], acActive = -1;
function closeAc() { if (acDrop) acDrop.hidden = true; acItems = []; acActive = -1; }
function traceToField(r, getReqs) {
  return refsField((r.traceTo || '').split(',').map(s => s.trim()).filter(Boolean),
    refs => { r.traceTo = refs.join(', '); }, getReqs, 'trace to…');
}
function refsField(initial, onChange, getReqs, placeholder) {
  const wrap = document.createElement('div'); wrap.className = 'req-trace';
  let refs = (initial || []).slice();
  const chips = document.createElement('div'); chips.className = 'req-trace-chips';
  const inp = document.createElement('input'); inp.className = 'req-trace-inp'; inp.placeholder = refs.length ? '' : (placeholder || '');

  function sync() { onChange(refs.slice()); }
  function drawChips() {
    chips.textContent = '';
    const known = new Set(getReqs().map(q => q.id));
    refs.forEach((ref, i) => {
      const c = document.createElement('span'); c.className = 'req-chip' + (known.has(ref) ? '' : ' req-chip-unknown');
      c.textContent = ref;
      const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Remove';
      x.addEventListener('click', () => { refs.splice(i, 1); drawChips(); sync(); inp.placeholder = refs.length ? '' : (placeholder || ''); });
      c.appendChild(x); chips.appendChild(c);
    });
  }
  function addRef(v) { v = (v || '').trim().replace(/,+$/, ''); if (v && !refs.includes(v)) { refs.push(v); drawChips(); sync(); } inp.value = ''; inp.placeholder = ''; }

  function openAc() {
    const q = inp.value.trim().toLowerCase();
    acItems = getReqs().filter(x => !refs.includes(x.id) &&
      (!q || x.id.toLowerCase().includes(q) || (x.description || '').toLowerCase().includes(q))).slice(0, 10);
    if (!acDrop) { acDrop = document.createElement('div'); acDrop.className = 'ac-drop'; document.body.appendChild(acDrop); }
    if (!acItems.length) { acDrop.hidden = true; return; }
    if (acActive >= acItems.length) acActive = acItems.length - 1;
    acDrop.textContent = '';
    acItems.forEach((m, idx) => {
      const opt = document.createElement('div'); opt.className = 'ac-opt' + (idx === acActive ? ' is-active' : '');
      const id = document.createElement('span'); id.className = 'ac-id'; id.textContent = m.id;
      const de = document.createElement('span'); de.className = 'ac-desc'; de.textContent = m.description || '';
      opt.append(id, de);
      opt.addEventListener('mousedown', e => { e.preventDefault(); addRef(m.id); closeAc(); });
      acDrop.appendChild(opt);
    });
    const rc = inp.getBoundingClientRect();
    acDrop.style.left = (window.scrollX + rc.left) + 'px';
    acDrop.style.top = (window.scrollY + rc.bottom + 3) + 'px';
    acDrop.style.minWidth = Math.max(240, rc.width) + 'px';
    acDrop.hidden = false;
  }
  inp.addEventListener('focus', () => { acActive = -1; openAc(); });
  inp.addEventListener('input', () => { acActive = -1; openAc(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); acActive = Math.min(acItems.length - 1, acActive + 1); openAc(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); acActive = Math.max(0, acActive - 1); openAc(); }
    else if (e.key === 'Enter') { e.preventDefault(); addRef(acActive >= 0 && acItems[acActive] ? acItems[acActive].id : inp.value); closeAc(); }
    else if (e.key === ',') { e.preventDefault(); addRef(inp.value); closeAc(); }
    else if (e.key === 'Escape') { closeAc(); }
  });
  inp.addEventListener('blur', () => setTimeout(closeAc, 150));
  wrap.append(chips, inp);
  drawChips();
  return wrap;
}
