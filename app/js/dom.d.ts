/**
 * A valid elem()/append() child: a DOM node, or text (stringified) - or a
 * null / undefined / false value, which is skipped, so `cond && child` and
 * `list.map(...)` drop straight in. Arrays are flattened to any depth.
 */
export type Child = Node | string | number | boolean | null | undefined | false;
/**
 * One child slot as a caller writes it: a single Child, or a list of them, so a
 * `list.map(...)` drops straight in. append() takes a slot per argument OR a
 * whole list of slots in one - that second shape is how elem() forwards its
 * entire rest array in a single call.
 */
export type ChildSlot = Child | Child[];
/**
 * What one entry of an ElemProps bag may hold: text for a property or an
 * attribute, or a listener for an on* key. Deliberately NOT `any` - it is the
 * closed set of things applyProps below knows how to do something with, so a
 * caller that passes an object or an array is told at the call site rather than
 * silently getting "[object Object]" in the DOM.
 */
export type ElemPropValue = string | number | boolean | EventListener | null | undefined;
/**
 * elem()'s second argument is EITHER a className string (the common case) OR
 * a props object:
 *   class / className        -> element.className
 *   text  / textContent      -> element.textContent
 *   html  / innerHTML        -> element.innerHTML
 *   onClick, onInput, on...  -> addEventListener('click' | 'input' | ...)
 *   style                    -> the inline style string
 *   any DOM property (type, value, disabled, hidden, href, ...) -> set directly
 *   anything else (aria-*, data-*, ...) -> setAttribute
 *   a null / undefined value is skipped.
 *
 * The aliases are spelled out so they are discoverable and so a typo in one of
 * them is at least a wrong TYPE rather than a silent setAttribute. The index
 * signature is not a shortcut: the remaining key set is genuinely open by
 * design - every DOM property of every element, plus every aria-* / data-*
 * attribute - and that open set is exactly what the list above promises.
 */
export interface ElemProps {
    class?: string;
    className?: string;
    text?: string | number;
    textContent?: string | number;
    html?: string;
    innerHTML?: string;
    style?: string;
    [key: string]: ElemPropValue;
}
/** Build an element, second argument being its className. */
export declare function elem<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, ...children: ChildSlot[]): HTMLElementTagNameMap[K];
/** Build an element, second argument being a props bag (see ElemProps). */
export declare function elem<K extends keyof HTMLElementTagNameMap>(tag: K, props?: ElemProps, ...children: ChildSlot[]): HTMLElementTagNameMap[K];
/**
 * Append a flat list of children to a parent, skipping empties (see Child).
 * Exported so callers can add children to an existing node the same way.
 */
export declare function append(node: Element, ...children: (ChildSlot | ChildSlot[])[]): Element;
