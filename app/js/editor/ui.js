// editor/ui.js - small shared DOM helpers and the block-type picker menu.
// These primitives are used across the editor's canvas, widgets and panels, so
// they live in one dependency-free place.

export function iconBtn(label, title, fn) { const b = document.createElement('button'); b.className = 'blk-ico'; b.textContent = label; b.title = title; b.addEventListener('click', fn); return b; }
export function smallBtn(label, fn) { const b = document.createElement('button'); b.className = 'blk-small'; b.textContent = label; b.addEventListener('click', fn); return b; }
export function labelEl(t) { const l = document.createElement('label'); l.textContent = t; return l; }
export function labeledInput(label, val, onChange) {
  const w = document.createElement('div'); w.className = 'meta-field';
  w.appendChild(labelEl(label));
  const i = document.createElement('input'); i.value = val; i.addEventListener('input', () => onChange(i.value)); w.appendChild(i);
  return w;
}
export function labeledTextarea(label, val, onChange) {
  const w = document.createElement('div'); w.className = 'meta-field';
  w.appendChild(labelEl(label));
  const t = document.createElement('textarea'); t.rows = 3; t.value = val; t.addEventListener('input', () => onChange(t.value)); w.appendChild(t);
  return w;
}

// The list of block types offered by the "+ Add block" / insert menus.
const BLOCK_MENU = [
  { type: 'paragraph', label: 'Text' },
  { type: 'heading', label: 'Heading' },
  { type: 'list', label: 'Bulleted list' },
  { type: 'list-ordered', label: 'Numbered list' },
  { type: 'code', label: 'Code' },
  { type: 'quote', label: 'Quote' },
  { type: 'table', label: 'Table' },
  { type: 'image', label: 'Image' },
  { type: 'hr', label: 'Divider' },
  { type: 'requirement', label: 'Requirement group' },
  { type: 'testcase', label: 'Test case' }
];

let menuEl = null;
export function openBlockMenu(anchor, pick) {
  if (menuEl) menuEl.remove();
  menuEl = document.createElement('div'); menuEl.className = 'blk-menu';
  BLOCK_MENU.forEach(m => { const b = document.createElement('button'); b.textContent = m.label; b.addEventListener('click', () => { pick(m.type); menuEl.remove(); menuEl = null; }); menuEl.appendChild(b); });
  document.body.appendChild(menuEl);
  const r = anchor.getBoundingClientRect();
  menuEl.style.top = (window.scrollY + r.bottom + 4) + 'px';
  menuEl.style.left = (window.scrollX + r.left) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (menuEl && !menuEl.contains(e.target)) { menuEl.remove(); menuEl = null; document.removeEventListener('mousedown', off); } }), 0);
}
