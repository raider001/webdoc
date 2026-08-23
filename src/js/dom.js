// dom.js - a tiny element builder that replaces the
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
 * @typedef {Node|string|number|boolean|null|undefined|false} Child
 */

/**
 * One child slot as a caller writes it: a single Child, or a list of them, so a
 * `list.map(...)` drops straight in. append() takes a slot per argument OR a
 * whole list of slots in one - that second shape is how elem() forwards its
 * entire rest array in a single call.
 * @typedef {Child|Child[]} ChildSlot
 */

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
 * @typedef {Object<string, *>} ElemProps
 */

/**
 * Generic over the tag so the call site gets the REAL element type back:
 * elem('input', ...) is an HTMLInputElement with .value, elem('canvas', ...)
 * has .getContext. Returning a bare HTMLElement instead was the single largest
 * source of "property does not exist" across the app, because almost every
 * element in the UI is built through here.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string|ElemProps} [props] - a className string, or a props object
 * @param {...ChildSlot} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function elem(tag, props, ...children) {
  const node = document.createElement(tag);
  if (typeof props === 'string') node.className = props;
  else if (props) applyProps(node, props);
  append(node, children);
  return node;
}

/**
 * Append a flat list of children to a parent, skipping empties (see Child).
 * Exported so callers can add children to an existing node the same way.
 * @param {Element} node
 * @param {...(ChildSlot|ChildSlot[])} children
 * @returns {Element}
 */
export function append(node, ...children) {
  // flat(Infinity) really does level the whole tree, but the checker only models
  // one level of it, so the result is spelled out here.
  for (const child of /** @type {Child[]} */ (children.flat(Infinity))) {
    if (child == null || child === false) continue;
    node.append(isNode(child) ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * Nodes go in as-is, everything else is stringified. Duck-typed on nodeType
 * rather than `instanceof Node` so a node built in another document (an
 * imported template, an iframe) is still recognised as one.
 * @param {Child} child
 * @returns {child is Node}
 */
function isNode(child) {
  return typeof child === 'object' && child !== null && 'nodeType' in child;
}

/**
 * @param {HTMLElement} node
 * @param {ElemProps} props
 */
function applyProps(node, props) {
  for (const key in props) {
    const value = props[key];
    if (value == null) continue;
    if (key === 'class' || key === 'className') node.className = value;
    else if (key === 'text' || key === 'textContent') node.textContent = value;
    else if (key === 'html' || key === 'innerHTML') node.innerHTML = value;
    else if (key === 'style') node.setAttribute('style', value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    // `key in node` IS the check that this property exists; the checker cannot
    // follow it into an indexed write, and the set is genuinely open-ended
    // (value, checked, href, disabled, ...), so the write goes through the same
    // heterogeneous-bag view of the node that ElemProps already describes.
    else if (key in node) /** @type {Object<string, *>} */ (node)[key] = value;
    else node.setAttribute(key, value);
  }
}
