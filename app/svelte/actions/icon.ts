// icon.ts - `use:icon={fn}` renders one of the app's own icons into a node.
//
// THE SEAM. app/js/icons.js returns a FRESH DOM element per call (a single SVG
// cannot live in two places at once), which is a pattern Svelte markup cannot
// express directly - so an action appends the node the app already knows how to
// build. Crucially the icon module is imported through "/js/icons.js", which
// vite.config.ts keeps external: the component uses the SAME module instance the
// vanilla shell does, not a bundled copy.

/** An icons.js factory, or null for none. */
export type IconFactory = (() => Element | null) | null;

export function icon(
  node: HTMLElement,
  make: IconFactory,
): { update: (make: IconFactory) => void; destroy: () => void } {
  let current: Element | null = null;
  function render(fn: IconFactory): void {
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
