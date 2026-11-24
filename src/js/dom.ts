// dom.ts - a tiny element builder that replaces the
// create-element / set-className / set-textContent / append boilerplate repeated
// thousands of times across the app. One readable expression per element:
//
//   elem('span', 'cov-name', name)                     -> <span class="cov-name">name</span>
//   elem('button', { class: 'btn', type: 'button', onClick: save }, 'Save')
//   elem('div', 'row', childA, childB, maybeChild && childC)   // children in order

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
export function elem<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, ...children: ChildSlot[]): HTMLElementTagNameMap[K];
/** Build an element, second argument being a props bag (see ElemProps). */
export function elem<K extends keyof HTMLElementTagNameMap>(
  tag: K, props?: ElemProps, ...children: ChildSlot[]): HTMLElementTagNameMap[K];
/**
 * Generic over the tag so the call site gets the REAL element type back:
 * elem('input', ...) is an HTMLInputElement with .value, elem('canvas', ...)
 * has .getContext. Returning a bare HTMLElement instead was the single largest
 * source of "property does not exist" across the app, because almost every
 * element in the UI is built through here.
 *
 * Two overloads rather than one `string | ElemProps` parameter, so the two
 * argument shapes are checked separately: with the union, an object literal is
 * checked against the union and every misspelled prop still matches the string
 * arm somewhere in the error message. Split, `elem('div', 'row', ...)` and
 * `elem('div', { class: 'row' }, ...)` each get an error about the shape the
 * caller actually wrote.
 */
export function elem<K extends keyof HTMLElementTagNameMap>(
  tag: K, props?: string | ElemProps, ...children: ChildSlot[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (typeof props === 'string') node.className = props;
  else if (props) applyProps(node, props);
  append(node, children);
  return node;
}

/**
 * Append a flat list of children to a parent, skipping empties (see Child).
 * Exported so callers can add children to an existing node the same way.
 */
export function append(node: Element, ...children: (ChildSlot | ChildSlot[])[]): Element {
  // flat(Infinity) really does level the whole tree, but the checker only models
  // one level of it, so the result is spelled out here.
  for (const child of children.flat(Infinity) as Child[]) {
    if (child == null || child === false) continue;
    node.append(isNode(child) ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * Nodes go in as-is, everything else is stringified. Duck-typed on nodeType
 * rather than `instanceof Node` so a node built in another document (an
 * imported template, an iframe) is still recognised as one.
 */
function isNode(child: Child): child is Node {
  return typeof child === 'object' && child !== null && 'nodeType' in child;
}

function applyProps(node: HTMLElement, props: ElemProps): void {
  for (const key in props) {
    const value = props[key];
    if (value == null) continue;
    // The `as string` on each DOM sink is the same claim the JS made implicitly:
    // these are all DOMString slots, so whatever arrives is stringified by the
    // setter anyway. The assertion says which slot is being written, it does not
    // add a conversion - the emitted code is the bare assignment it always was.
    if (key === 'class' || key === 'className') node.className = value as string;
    else if (key === 'text' || key === 'textContent') node.textContent = value as string;
    else if (key === 'html' || key === 'innerHTML') node.innerHTML = value as string;
    else if (key === 'style') node.setAttribute('style', value as string);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    // `key in node` IS the check that this property exists; the checker cannot
    // follow it into an indexed write, and the set is genuinely open-ended
    // (value, checked, href, disabled, ...), so the write goes through the same
    // heterogeneous-bag view of the node that ElemProps already describes.
    else if (key in node) (node as unknown as Record<string, ElemPropValue>)[key] = value;
    else node.setAttribute(key, value as string);
  }
}
