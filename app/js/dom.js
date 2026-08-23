// dom.ts - a tiny element builder that replaces the
// create-element / set-className / set-textContent / append boilerplate repeated
// thousands of times across the app. One readable expression per element:
//
//   elem('span', 'cov-name', name)                     -> <span class="cov-name">name</span>
//   elem('button', { class: 'btn', type: 'button', onClick: save }, 'Save')
//   elem('div', 'row', childA, childB, maybeChild && childC)   // children in order
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
export function elem(tag, props, ...children) {
    const node = document.createElement(tag);
    if (typeof props === 'string')
        node.className = props;
    else if (props)
        applyProps(node, props);
    append(node, children);
    return node;
}
/**
 * Append a flat list of children to a parent, skipping empties (see Child).
 * Exported so callers can add children to an existing node the same way.
 */
export function append(node, ...children) {
    // flat(Infinity) really does level the whole tree, but the checker only models
    // one level of it, so the result is spelled out here.
    for (const child of children.flat(Infinity)) {
        if (child == null || child === false)
            continue;
        node.append(isNode(child) ? child : document.createTextNode(String(child)));
    }
    return node;
}
/**
 * Nodes go in as-is, everything else is stringified. Duck-typed on nodeType
 * rather than `instanceof Node` so a node built in another document (an
 * imported template, an iframe) is still recognised as one.
 */
function isNode(child) {
    return typeof child === 'object' && child !== null && 'nodeType' in child;
}
function applyProps(node, props) {
    for (const key in props) {
        const value = props[key];
        if (value == null)
            continue;
        // The `as string` on each DOM sink is the same claim the JS made implicitly:
        // these are all DOMString slots, so whatever arrives is stringified by the
        // setter anyway. The assertion says which slot is being written, it does not
        // add a conversion - the emitted code is the bare assignment it always was.
        if (key === 'class' || key === 'className')
            node.className = value;
        else if (key === 'text' || key === 'textContent')
            node.textContent = value;
        else if (key === 'html' || key === 'innerHTML')
            node.innerHTML = value;
        else if (key === 'style')
            node.setAttribute('style', value);
        else if (key.startsWith('on') && typeof value === 'function')
            node.addEventListener(key.slice(2).toLowerCase(), value);
        // `key in node` IS the check that this property exists; the checker cannot
        // follow it into an indexed write, and the set is genuinely open-ended
        // (value, checked, href, disabled, ...), so the write goes through the same
        // heterogeneous-bag view of the node that ElemProps already describes.
        else if (key in node)
            node[key] = value;
        else
            node.setAttribute(key, value);
    }
}
