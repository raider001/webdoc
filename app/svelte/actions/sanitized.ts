// Read-only stored-response rendering; kept outside the editor action module.
import { sanitizeToFragment } from '/js/sanitize.js';

/**
 * Append one run's stored response HTML to a node, sanitized.
 * @param node - the host; content is APPENDED after whatever
 *   Svelte already put there (the "Actual: " label)
 * @param html - as recorded by a previous run
 */
export function sanitized(node: HTMLElement, html: string): { destroy: () => void } {
  // A DocumentFragment is emptied by appendChild, so the children are kept by
  // hand - they are the only handle on what to take out again.
  const frag = sanitizeToFragment(String(html || ''));
  let placed: ChildNode[] = [...frag.childNodes];
  node.appendChild(frag);
  return {
    destroy() {
      placed.forEach(n => n.remove());
      placed = [];
    },
  };
}
