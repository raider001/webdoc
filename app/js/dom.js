// dom.js - a tiny element builder that replaces the
// create-element / set-className / set-textContent / append boilerplate repeated
// thousands of times across the app. One readable expression per element:
//
//   elem('span', 'cov-name', name)                     -> <span class="cov-name">name</span>
//   elem('button', { class: 'btn', type: 'button', onClick: save }, 'Save')
//   elem('div', 'row', childA, childB, maybeChild && childC)   // children in order
//
// Second argument is EITHER a className string (the common case) OR a props object:
//   class / className        -> element.className
//   text  / textContent      -> element.textContent
//   html  / innerHTML        -> element.innerHTML
//   onClick, onInput, on...  -> addEventListener('click' | 'input' | ...)
//   style                    -> the inline style string
//   any DOM property (type, value, disabled, hidden, href, ...) -> set directly
//   anything else (aria-*, data-*, ...) -> setAttribute
//   a null / undefined value is skipped.
//
// Remaining arguments are children: DOM nodes are appended as-is, strings become
// text nodes, arrays are flattened, and null / undefined / false are skipped (so
// `cond && child` and `list.map(...)` drop straight in).
export function elem(tag, props, ...children) {
  const node = document.createElement(tag);
  if (typeof props === 'string') node.className = props;
  else if (props) applyProps(node, props);
  append(node, children);
  return node;
}

// Append a flat list of children to a parent, skipping empties (see elem's rules).
// Exported so callers can add children to an existing node the same way.
export function append(node, ...children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function applyProps(node, props) {
  for (const key in props) {
    const value = props[key];
    if (value == null) continue;
    if (key === 'class' || key === 'className') node.className = value;
    else if (key === 'text' || key === 'textContent') node.textContent = value;
    else if (key === 'html' || key === 'innerHTML') node.innerHTML = value;
    else if (key === 'style') node.setAttribute('style', value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
}
