// editor/widgets.js - the structured block widgets: table editor, requirement
// group, test case, and the shared reference-picker (chips + autocomplete) that
// backs both a requirement's Trace-To and a test case's Verifies.
import { elem, append } from '../dom.js';
import { smallBtn } from './ui.js';
import { editable } from './richtext.js';

function span(text) { return elem('span', null, text); }

/* ---- table editor ---- */
export function tableEditor(b) {
  const box = elem('div', 'blk-tablebox');

  function draw() {
    box.textContent = '';
    const table = elem('table', 'blk-table',
      elem('tr', null, b.headers.map((h, ci) => cell(h, v => b.headers[ci] = v, true))),
      b.rows.map((row, ri) => elem('tr', null, row.map((c, ci) => cell(c, v => b.rows[ri][ci] = v, false)))));
    const controls = elem('div', 'blk-table-ctr',
      smallBtn('+ Row', () => { b.rows.push(b.headers.map(() => '')); draw(); }),
      smallBtn('+ Column', () => { b.headers.push('Column ' + (b.headers.length + 1)); b.aligns.push(''); b.rows.forEach(r => r.push('')); draw(); }),
      b.rows.length > 0 && smallBtn('− Row', () => { b.rows.pop(); draw(); }),
      b.headers.length > 1 && smallBtn('− Column', () => { b.headers.pop(); b.aligns.pop(); b.rows.forEach(r => r.pop()); draw(); }));
    append(box, table, controls);
  }

  // Cells are rich text (contenteditable), so they hold inline Markdown - bold,
  // links, `code`, and images - not just plain strings. The stored cell value is
  // inline HTML; serialize.js converts each cell via htmlToMd (GFM cells accept
  // inline markdown as long as it stays on one line and pipes are escaped).
  function cell(value, onChange, isHeader) {
    return elem(isHeader ? 'th' : 'td', null, editable(value || '', 'tablecell', onChange, ''));
  }

  draw();
  return box;
}

/* ---- requirement widget ---- */
export function requirementWidget(b, getReqs) {
  const groupInput = elem('input', { value: b.group || '', placeholder: 'e.g. sys', onInput: () => b.group = groupInput.value.trim() });
  const table = elem('div');
  const box = elem('div', 'blk-reqbox', elem('label', 'blk-reqgroup', 'Requirement group ', groupInput), table);

  function draw() {
    table.textContent = '';
    append(table,
      elem('div', 'req-row req-head', span('No.'), span('Description'), span('Trace to'), span('')),
      b.rows.map((r, i) => elem('div', 'req-row',
        field(r.no, v => r.no = v, 'no'),
        field(r.description, v => r.description = v, 'wide'),
        traceToField(r, getReqs),
        smallBtn('✕', () => { b.rows.splice(i, 1); if (!b.rows.length) b.rows.push({ no: '1', description: '', traceTo: '' }); draw(); }))),
      elem('button', { class: 'blk-req-add', onClick: () => { b.rows.push({ no: String(b.rows.length + 1), description: '', traceTo: '' }); draw(); } }, '+ Requirement'));
  }

  function field(value, onChange, cls) {
    const input = elem('input', { class: 'req-f req-f-' + cls, value: value || '', onInput: () => onChange(input.value) });
    return input;
  }

  draw();
  return box;
}

/* ---- test-case widget: key + name + Verifies picker + action/expected steps ---- */
export function testCaseWidget(b, getReqs, comp) {
  const box = elem('div', 'blk-reqbox blk-tcbox');
  const preview = elem('div', 'blk-tc-preview');
  const table = elem('div');
  function updatePreview() { preview.textContent = 'id: T_' + (comp || '{component}') + '_' + (b.key || 'key'); }
  function labeled(text, node) { append(box, elem('label', 'blk-reqgroup', text + ' ', node)); }

  labeled('Test key', input(b.key, v => { b.key = v.trim(); updatePreview(); }, 'e.g. login-valid'));
  labeled('Name', input(b.name, v => b.name = v, 'e.g. Valid login'));
  append(box, preview);
  updatePreview();
  append(box, elem('label', 'blk-reqgroup blk-tc-verifies', 'Verifies ',
    refsField(b.verifies || [], refs => b.verifies = refs, getReqs, 'requirement…')));
  append(box, table);

  function draw() {
    table.textContent = '';
    append(table,
      elem('div', 'req-row tc-erow req-head', span('Action'), span('Expected response'), span('')),
      b.steps.map((s, i) => elem('div', 'req-row tc-erow',
        mdField(s.action, v => s.action = v, 'action (markdown ok)…'),
        mdField(s.expected, v => s.expected = v, 'expected response (markdown ok)…'),
        smallBtn('✕', () => { b.steps.splice(i, 1); if (!b.steps.length) b.steps.push({ action: '', expected: '' }); draw(); }))),
      elem('button', { class: 'blk-req-add', onClick: () => { b.steps.push({ action: '', expected: '' }); draw(); } }, '+ Step'));
  }

  // A single-line text input bound to onChange.
  function input(value, onChange, placeholder) {
    const node = elem('input', { value: value || '', placeholder: placeholder || '', onInput: () => onChange(node.value) });
    return node;
  }
  // A multi-line markdown source field (auto-grows to fit its content).
  function mdField(value, onChange, placeholder) {
    const textarea = elem('textarea', { class: 'req-f req-f-md', value: value || '', rows: 1, placeholder: placeholder || '' });
    const grow = () => { textarea.style.height = 'auto'; textarea.style.height = Math.max(30, textarea.scrollHeight) + 'px'; };
    textarea.addEventListener('input', () => { onChange(textarea.value); grow(); });
    setTimeout(grow, 0);
    return textarea;
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
  let refs = (initial || []).slice();
  const chips = elem('div', 'req-trace-chips');
  const input = elem('input', { class: 'req-trace-inp', placeholder: refs.length ? '' : (placeholder || '') });
  const wrap = elem('div', 'req-trace', chips, input);

  function sync() { onChange(refs.slice()); }
  function drawChips() {
    chips.textContent = '';
    const known = new Set(getReqs().map(q => q.id));
    refs.forEach((ref, i) => {
      const remove = elem('button', { title: 'Remove', onClick: () => {
        refs.splice(i, 1); drawChips(); sync(); input.placeholder = refs.length ? '' : (placeholder || '');
      } }, '✕');
      append(chips, elem('span', 'req-chip' + (known.has(ref) ? '' : ' req-chip-unknown'), ref, remove));
    });
  }
  function addRef(v) {
    v = (v || '').trim().replace(/,+$/, '');
    if (v && !refs.includes(v)) { refs.push(v); drawChips(); sync(); }
    input.value = ''; input.placeholder = '';
  }

  function openAc() {
    const q = input.value.trim().toLowerCase();
    acItems = getReqs().filter(x => !refs.includes(x.id) &&
      (!q || x.id.toLowerCase().includes(q) || (x.description || '').toLowerCase().includes(q))).slice(0, 10);
    if (!acDrop) { acDrop = elem('div', 'ac-drop'); document.body.appendChild(acDrop); }
    if (!acItems.length) { acDrop.hidden = true; return; }
    if (acActive >= acItems.length) acActive = acItems.length - 1;
    acDrop.textContent = '';
    acItems.forEach((match, idx) => append(acDrop,
      elem('div', { class: 'ac-opt' + (idx === acActive ? ' is-active' : ''), onMousedown: e => { e.preventDefault(); addRef(match.id); closeAc(); } },
        elem('span', 'ac-id', match.id),
        elem('span', 'ac-desc', match.description || ''))));
    const rect = input.getBoundingClientRect();
    acDrop.style.left = (window.scrollX + rect.left) + 'px';
    acDrop.style.top = (window.scrollY + rect.bottom + 3) + 'px';
    acDrop.style.minWidth = Math.max(240, rect.width) + 'px';
    acDrop.hidden = false;
  }
  input.addEventListener('focus', () => { acActive = -1; openAc(); });
  input.addEventListener('input', () => { acActive = -1; openAc(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); acActive = Math.min(acItems.length - 1, acActive + 1); openAc(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); acActive = Math.max(0, acActive - 1); openAc(); }
    else if (e.key === 'Enter') { e.preventDefault(); addRef(acActive >= 0 && acItems[acActive] ? acItems[acActive].id : input.value); closeAc(); }
    else if (e.key === ',') { e.preventDefault(); addRef(input.value); closeAc(); }
    else if (e.key === 'Escape') { closeAc(); }
  });
  input.addEventListener('blur', () => setTimeout(closeAc, 150));

  drawChips();
  return wrap;
}
