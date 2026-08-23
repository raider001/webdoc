// icon.js - `use:icon={fn}` renders one of the app's own icons into a node.
//
// THE SEAM. app/js/icons.js returns a FRESH DOM element per call (a single SVG
// cannot live in two places at once), which is a pattern Svelte markup cannot
// express directly - so an action appends the node the app already knows how to
// build. Crucially the icon module is imported through "/js/icons.js", which
// vite.config.js keeps external: the component uses the SAME module instance the
// vanilla shell does, not a bundled copy.

/**
 * @param {HTMLElement} node
 * @param {(() => Element|null)|null} make - an icons.js factory, or null for none
 * @returns {{update: (make: (() => Element|null)|null) => void, destroy: () => void}}
 */
export function icon(node, make) {
  /** @type {Element|null} */
  let current = null;
  /** @param {(() => Element|null)|null} fn */
  function render(fn) {
    if (current) { current.remove(); current = null; }
    if (!fn) return;
    current = fn();
    if (current) node.appendChild(current);
  }
  render(make);
  return {
    update: render,
    destroy: () => { if (current) current.remove(); },
  };
}
