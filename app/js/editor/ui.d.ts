import type { ChildSlot } from '../dom.js';
/**
 * @param icon an icons.js node, e.g. closeIcon() - nullable because every icon
 *   builder returns `firstElementChild`, and elem() skips an absent child
 */
export declare function iconBtn(icon: Element | null, title: string, onClick: (e: Event) => void): HTMLElement;
/**
 * @param content text, an icons.js node, or a mix - a ChildSlot, i.e. exactly
 *   what the elem() call below forwards it into
 */
export declare function smallBtn(content: ChildSlot, onClick: (e: Event) => void): HTMLElement;
export declare function labelEl(text: string): HTMLElement;
export declare function labeledInput(label: string, value: string, onChange: (value: string) => void): HTMLElement;
export declare function labeledTextarea(label: string, value: string, onChange: (value: string) => void): HTMLElement;
/** One entry in the "+ Add block" / insert menus. `acl` marks an entry only shown to accounts that may change access rules. */
export interface BlockMenuItem {
    type: string;
    label: string;
    acl?: boolean;
}
/**
 * @param anchor the menu is positioned below this element
 * @param pick called with the chosen block type
 */
export declare function openBlockMenu(anchor: Element, pick: (type: string) => void): void;
