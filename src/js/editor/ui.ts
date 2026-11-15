// editor/ui.ts - small shared DOM helpers and the block-type picker menu.
// These primitives are used across the editor's canvas, widgets and panels, so
// they live in one dependency-free place.
import { elem } from '../dom.js';
import type { ChildSlot } from '../dom.js';
import { auth } from '../auth.js';
import { registeredWidgets, widgetDisplayName } from '../widgets.js';

/**
 * @param icon an icons.js node, e.g. closeIcon() - nullable because every icon
 *   builder returns `firstElementChild`, and elem() skips an absent child
 */
export function iconBtn(icon: Element | null, title: string, onClick: (e: Event) => void): HTMLElement {
  return elem('button', { type: 'button', class: 'blk-ico', title, 'aria-label': title, onClick }, icon);
}
/**
 * @param content text, an icons.js node, or a mix - a ChildSlot, i.e. exactly
 *   what the elem() call below forwards it into
 */
export function smallBtn(content: ChildSlot, onClick: (e: Event) => void): HTMLElement {
  return elem('button', { type: 'button', class: 'blk-small', onClick }, content);
}
export function labelEl(text: string): HTMLElement {
  return elem('label', undefined, text);
}
export function labeledInput(label: string, value: string, onChange: (value: string) => void): HTMLElement {
  const input = elem('input', { value, onInput: () => onChange(input.value) });
  return elem('label', 'meta-field', elem('span', undefined, label), input);
}
export function labeledTextarea(label: string, value: string, onChange: (value: string) => void): HTMLElement {
  const textarea = elem('textarea', { rows: 3, value, onInput: () => onChange(textarea.value) });
  return elem('label', 'meta-field', elem('span', undefined, label), textarea);
}

export function mdField(value: string, onChange: (value: string) => void, name: string): HTMLTextAreaElement {
  const field = elem('textarea', { class: 'req-f req-f-md', value: value || '', rows: 1, 'aria-label': name });
  const grow = () => { field.style.height = 'auto'; field.style.height = Math.max(28, field.scrollHeight + 2) + 'px'; };
  field.addEventListener('input', () => { onChange(field.value); grow(); });
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(grow); observer?.observe(field);
  // The editor disconnects resize observers when their elements leave the tree.
  field.addEventListener('editor:destroy', () => observer?.disconnect(), { once: true });
  requestAnimationFrame(grow);
  return field;
}

/** One entry in the "+ Add block" / insert menus. `acl` marks an entry only shown to accounts that may change access rules. */
export interface BlockMenuItem { type: string; label: string; acl?: boolean }
/** The list of block types offered by the "+ Add block" / insert menus. */
const BLOCK_MENU: BlockMenuItem[] = [
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
  { type: 'testcase', label: 'Test case' },
  // Offered only to accounts that may change access rules (see openBlockMenu):
  // inserting one is a permission change, and the server refuses the save from
  // anyone else - so showing it to everyone would just be a trap.
  { type: 'access', label: 'Restricted section', acl: true }
];

/** The one open block menu, or null - opening a second closes the first. */
let menuClose: (() => void) | null = null;
export function closeBlockMenu() { menuClose?.(); }

export function openActionMenu(anchor: Element, items: { label: string; run: () => void; content?: ChildSlot; widget?: boolean }[]): void {
  menuClose?.();
  const menu = elem('div', { class: 'blk-menu', role: 'menu', 'aria-label': 'Block actions' });
  const close = (restore = true) => {
    menu.remove(); document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', onResize); document.removeEventListener('scroll', onScroll, true);
    anchor.setAttribute('aria-expanded', 'false'); if (menuClose === close) menuClose = null;
    if (restore && anchor.isConnected) (anchor as HTMLElement).focus({ preventScroll: true });
  };
  const outside = (e: Event) => { if (!menu.contains(e.target as Node)) close(false); };
  const onResize = () => close();
  // Opening a menu at the bottom of the canvas can deliver a queued scroll
  // event from scrolling its opener into view. Keep it anchored rather than
  // immediately closing it (including scroll caused by focus).
  const onScroll = (event: Event) => { if (!menu.contains(event.target as Node)) position(); };
  items.forEach(item => menu.append(elem('button', { type: 'button', class: item.widget ? 'blk-widget-menu-item' : '', role: 'menuitem', 'aria-label': item.label,
    onClick: () => { close(); item.run(); } }, item.content || item.label)));
  const buttons = [...menu.querySelectorAll('button')];
  menu.addEventListener('keydown', e => {
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Tab') close(false);
  });
  document.body.append(menu); anchor.setAttribute('aria-expanded', 'true');
  function position() {
    const r = anchor.getBoundingClientRect();
    menu.style.maxHeight = Math.max(0, innerHeight - 16) + 'px';
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8)) + 'px';
  }
  position();
  menuClose = close;
  document.addEventListener('pointerdown', outside, true); window.addEventListener('resize', onResize); document.addEventListener('scroll', onScroll, true);
  buttons[0]?.focus({ preventScroll: true });
}
/**
 * @param anchor the menu is positioned below this element
 * @param pick called with the chosen block type
 */
export function openBlockMenu(anchor: Element, pick: (type: string) => void, widgetsOnly = false): void {
  openActionMenu(anchor, [
    ...(widgetsOnly ? [] : BLOCK_MENU).filter(item => !item.acl || auth.canEditAccess).map(item => ({ label: item.label, run: () => pick(item.type) })),
    ...registeredWidgets().map(widget => ({ label: widgetDisplayName(widget), widget: true, content: [elem('span', { class: 'widget-type-icon', 'aria-hidden': true }, widget.icon || '◇'), elem('span', undefined, elem('strong', undefined, widgetDisplayName(widget)), elem('small', undefined, widget.description || ''))], run: () => pick('widget:' + widget.name) }))
  ]);
}
