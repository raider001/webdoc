// editor/widgets.ts - the structured block widgets: table editor, requirement
// group, test case, and the shared reference-picker (chips + autocomplete) that
// backs both a requirement's Trace-To and a test case's Verifies.
import { elem, append } from '../dom.js';
import { smallBtn } from './ui.js';
import { editable } from './richtext.js';
import { plusIcon, minusIcon, closeIcon, lockIcon } from '../icons.js';
import { auth } from '../auth.js';
import { groupChip, destroyGroupChip } from '../auth-ui.js';
import type { AccessStartBlock, AccessEndBlock } from '../editor.js';

function span(text: string): HTMLElement { return elem('span', null, text); }

/* ---- table editor ---- */

/**
 * A table block. Cell values are inline HTML (rich text), not plain strings -
 * serialize.ts converts each cell to Markdown via htmlToMd on save.
 */
export interface TableBlock {
  type: 'table';
  headers: string[];
  aligns: string[];
  rows: string[][];
}

export function tableEditor(b: TableBlock): HTMLElement {
  const box = elem('div', 'blk-tablebox');

  function draw() {
    box.textContent = '';
    const table = elem('table', 'blk-table',
      elem('tr', null, b.headers.map((h, ci) => cell(h, v => b.headers[ci] = v, true))),
      b.rows.map((row, ri) => elem('tr', null, row.map((c, ci) => cell(c, v => b.rows[ri][ci] = v, false)))));
    const controls = elem('div', 'blk-table-ctr',
      smallBtn([plusIcon(), ' Row'], () => { b.rows.push(b.headers.map(() => '')); draw(); }),
      smallBtn([plusIcon(), ' Column'], () => { b.headers.push('Column ' + (b.headers.length + 1)); b.aligns.push(''); b.rows.forEach(r => r.push('')); draw(); }),
      b.rows.length > 0 && smallBtn([minusIcon(), ' Row'], () => { b.rows.pop(); draw(); }),
      b.headers.length > 1 && smallBtn([minusIcon(), ' Column'], () => { b.headers.pop(); b.aligns.pop(); b.rows.forEach(r => r.pop()); draw(); }));
    append(box, table, controls);
  }

  // Cells are rich text (contenteditable), so they hold inline Markdown - bold,
  // links, `code`, and images - not just plain strings. The stored cell value is
  // inline HTML; serialize.ts converts each cell via htmlToMd (GFM cells accept
  // inline markdown as long as it stays on one line and pipes are escaped).
  /**
   * @param value inline HTML
   */
  function cell(value: string, onChange: (value: string) => void, isHeader: boolean): HTMLElement {
    return elem(isHeader ? 'th' : 'td', null, editable(value || '', 'tablecell', onChange, ''));
  }

  draw();
  return box;
}

/* ---- requirement widget ---- */

/**
 * One row of a requirement group: number + description (plain text) plus its
 * trace-to references (comma-joined ids, e.g. "sys_2, fn_3").
 */
export interface RequirementRow {
  no: string;
  description: string;
  traceTo: string;
}

export interface ReqBlock {
  type: 'requirement';
  group: string;
  rows: RequirementRow[];
}

/**
 * A requirement (or in-progress row) offered by the Trace-To / Verifies
 * reference picker's autocomplete.
 */
export interface ReqRef {
  id: string;
  description: string;
  docId?: string;
  group?: string;
}

/** Every requirement known right now (saved ones plus this doc's in-progress rows). */
export type GetReqs = () => ReqRef[];

export function requirementWidget(b: ReqBlock, getReqs: GetReqs): HTMLElement {
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
        smallBtn(closeIcon(), () => { b.rows.splice(i, 1); if (!b.rows.length) b.rows.push({ no: '1', description: '', traceTo: '' }); draw(); }))),
      elem('button', { class: 'blk-req-add', onClick: () => { b.rows.push({ no: String(b.rows.length + 1), description: '', traceTo: '' }); draw(); } }, plusIcon(), ' Requirement'));
  }

  function field(value: string, onChange: (value: string) => void, cls: string): HTMLInputElement {
    const input = elem('input', { class: 'req-f req-f-' + cls, value: value || '', onInput: () => onChange(input.value) });
    return input;
  }

  draw();
  return box;
}

/* ---- test-case widget: key + name + Verifies picker + action/expected steps ---- */

export interface TestStep {
  /** markdown source */
  action: string;
  /** markdown source */
  expected: string;
}

export interface TestCaseBlock {
  type: 'testcase';
  key: string;
  name: string;
  /** requirement/test ids this case verifies */
  verifies?: string[];
  steps: TestStep[];
}

/**
 * @param comp component id, for the "id: T_{comp}_{key}" preview
 */
export function testCaseWidget(b: TestCaseBlock, getReqs: GetReqs, comp?: string): HTMLElement {
  const box = elem('div', 'blk-reqbox blk-tcbox');
  const preview = elem('div', 'blk-tc-preview');
  const table = elem('div');
  function updatePreview() { preview.textContent = 'id: T_' + (comp || '{component}') + '_' + (b.key || 'key'); }
  /**
   * @param node the field the label wraps
   */
  function labeled(text: string, node: HTMLElement) { append(box, elem('label', 'blk-reqgroup', text + ' ', node)); }

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
        smallBtn(closeIcon(), () => { b.steps.splice(i, 1); if (!b.steps.length) b.steps.push({ action: '', expected: '' }); draw(); }))),
      elem('button', { class: 'blk-req-add', onClick: () => { b.steps.push({ action: '', expected: '' }); draw(); } }, plusIcon(), ' Step'));
  }

  /**
   * A single-line text input bound to onChange.
   */
  function input(value: string, onChange: (value: string) => void, placeholder?: string): HTMLInputElement {
    const node = elem('input', { value: value || '', placeholder: placeholder || '', onInput: () => onChange(node.value) });
    return node;
  }
  /**
   * A multi-line markdown source field (auto-grows to fit its content).
   */
  function mdField(value: string, onChange: (value: string) => void, placeholder?: string): HTMLTextAreaElement {
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
// One dropdown for the whole page (there is only ever one focused field), so it
// is module state rather than per-field: acItems is the currently offered slice,
// acActive the keyboard cursor into it (-1 = nothing highlighted).
let acDrop: HTMLElement | null = null, acItems: ReqRef[] = [], acActive = -1;
function closeAc() { if (acDrop) acDrop.hidden = true; acItems = []; acActive = -1; }

function traceToField(r: RequirementRow, getReqs: GetReqs): HTMLElement {
  return refsField((r.traceTo || '').split(',').map(s => s.trim()).filter(Boolean),
    refs => { r.traceTo = refs.join(', '); }, getReqs, 'trace to…');
}

function refsField(initial: string[], onChange: (refs: string[]) => void, getReqs: GetReqs, placeholder?: string): HTMLElement {
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
      } }, closeIcon());
      append(chips, elem('span', 'req-chip' + (known.has(ref) ? '' : ' req-chip-unknown'), ref, remove));
    });
  }
  /**
   * @param v a typed or picked reference id
   */
  function addRef(v: string) {
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
      elem('div', { class: 'ac-opt' + (idx === acActive ? ' is-active' : ''), onMousedown: (e: MouseEvent) => { e.preventDefault(); addRef(match.id); closeAc(); } },
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

/* ---- access-marker blocks ---- */
/**
 * The editor view of an `<!--access start-->` / `<!--access end-->` marker.
 *
 * These are markers, not containers: the protected content is whatever blocks
 * sit BETWEEN them. Rendering them as visible bookends is what stops an author
 * moving or deleting one by accident - and what stops the editor silently
 * dropping a permission boundary it could not represent.
 *
 * The group pickers are disabled for anyone without access-management rights.
 * That is courtesy, not enforcement: the server compares the access rules in an
 * incoming save against the ones on disk and refuses the write either way.
 *
 * @param knownGroups groups declared in config.json, offered as checkboxes
 */
export function accessMarker(b: AccessStartBlock | AccessEndBlock, knownGroups?: string[]): HTMLElement {
  if (b.type === 'access-end') {
    return elem('div', 'access-marker is-end',
      lockIcon(), elem('span', 'access-marker-label', 'End of restricted section'));
  }
  b.read = Array.isArray(b.read) ? b.read : [];
  const editableAcl = auth.canEditAccess;

  const chips = elem('div', 'group-chips');
  const drawChips = () => {
    chips.querySelectorAll('.wd-mounted').forEach(destroyGroupChip);   // chips are islands now; clearing alone would not stop them
    chips.textContent = '';
    append(chips, b.read.length
      ? b.read.map(g => groupChip(g, { small: true }))
      : elem('span', 'auth-muted', 'No group selected - only administrators will see this section.'));
  };

  const picker = elem('div', 'access-row');
  for (const name of (knownGroups || [])) {
    const box = elem('input', { type: 'checkbox', checked: b.read.indexOf(name) !== -1, disabled: !editableAcl });
    box.addEventListener('change', () => {
      const set = new Set(b.read);
      if (box.checked) set.add(name); else set.delete(name);
      b.read = [...set].sort();
      drawChips();
    });
    append(picker, elem('label', 'access-pick', box, groupChip(name, { small: true })));
  }

  const label = elem('input', {
    class: 'blk-lang', placeholder: 'Section label (optional)', value: b.label || '', disabled: !editableAcl,
    onInput: (e: Event) => { b.label = (e.target as HTMLInputElement).value; }
  });

  drawChips();
  return elem('div', 'access-marker is-start' + (editableAcl ? '' : ' access-readonly'),
    elem('div', 'access-marker-head', lockIcon(),
      elem('span', 'access-marker-label', 'Restricted section - readable by'), chips),
    picker, label,
    !editableAcl && elem('p', 'access-note',
      'You can edit the text inside this section, but only an account with access-management rights can change who may read it.'));
}
