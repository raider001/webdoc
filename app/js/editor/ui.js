// editor/ui.ts - small shared DOM helpers and the block-type picker menu.
// These primitives are used across the editor's canvas, widgets and panels, so
// they live in one dependency-free place.
import { elem } from '../dom.js';
import { auth } from '../auth.js';
/**
 * @param icon an icons.js node, e.g. closeIcon()
 */
export function iconBtn(icon, title, onClick) {
    return elem('button', { class: 'blk-ico', title, onClick }, icon);
}
/**
 * @param content text, an icons.js node, or a mix
 */
export function smallBtn(content, onClick) {
    return elem('button', { class: 'blk-small', onClick }, content);
}
export function labelEl(text) {
    return elem('label', null, text);
}
export function labeledInput(label, value, onChange) {
    const input = elem('input', { value, onInput: () => onChange(input.value) });
    return elem('div', 'meta-field', labelEl(label), input);
}
export function labeledTextarea(label, value, onChange) {
    const textarea = elem('textarea', { rows: 3, value, onInput: () => onChange(textarea.value) });
    return elem('div', 'meta-field', labelEl(label), textarea);
}
/** The list of block types offered by the "+ Add block" / insert menus. */
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
    { type: 'testcase', label: 'Test case' },
    // Offered only to accounts that may change access rules (see openBlockMenu):
    // inserting one is a permission change, and the server refuses the save from
    // anyone else - so showing it to everyone would just be a trap.
    { type: 'access', label: 'Restricted section', acl: true }
];
/** The one open block menu, or null - opening a second closes the first. */
let menuEl = null;
/**
 * @param anchor the menu is positioned below this element
 * @param pick called with the chosen block type
 */
export function openBlockMenu(anchor, pick) {
    if (menuEl)
        menuEl.remove();
    menuEl = elem('div', 'blk-menu', BLOCK_MENU.filter(item => !item.acl || auth.canEditAccess)
        .map(item => elem('button', { onClick: () => { pick(item.type); close(); } }, item.label)));
    document.body.appendChild(menuEl);
    const rect = anchor.getBoundingClientRect();
    menuEl.style.top = (window.scrollY + rect.bottom + 4) + 'px';
    menuEl.style.left = (window.scrollX + rect.left) + 'px';
    function close() { if (menuEl) {
        menuEl.remove();
        menuEl = null;
    } }
    // Close on the next mousedown outside the menu.
    setTimeout(() => document.addEventListener('mousedown', function off(e) {
        if (menuEl && !menuEl.contains(e.target)) {
            close();
            document.removeEventListener('mousedown', off);
        }
    }), 0);
}
