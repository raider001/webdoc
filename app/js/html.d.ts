import type { ChildSlot } from './dom.js';
export declare function html(strings: TemplateStringsArray, ...values: ChildSlot[]): DocumentFragment;
export declare function fillSlots(root: Node, values: ChildSlot[]): void;
