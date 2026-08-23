// richtext.ts - the two halves of a recorded test response: `use:richtext`
// writes one, `use:sanitized` reads one back.
//
// THE CARVE-OUT (`use:richtext`). A contenteditable is a field whose value lives
// in the DOM. The moment a framework re-renders it from state the caret jumps to
// the start, the browser's undo stack is discarded and an IME composition is
// torn in half - and it re-renders on every keystroke, because the keystroke is
// what updated the state. So the field is created ONCE by app/js/editor.js's
// richText(), which also gives it the shared inline toolbar (Bold / Italic /
// Code / Link / Image), and nothing ever writes to it again: the only traffic is
// outward, through onchange.
//
// WHY THE IMPORT IS DYNAMIC, exactly as in ./graph.ts: editor.js is the head of
// the whole block-editor graph, the island bundle is loaded at boot for every
// reader, and a static import here would put the editor in every cold start.
// main.js already says as much where it lazily imports runner.js. A reader who
// never records a test run never downloads it.
//
// `use:sanitized` is the other direction and is NOT the same as
// ./fragment.ts's `use:fragment`: fragment renders authored MARKDOWN, this
// renders HTML that a previous run already stored. Both end at
// app/js/sanitize.js, which stays the one and only producer of trusted markup -
// a stored response is attacker-controlled text like any other.
import { sanitizeToFragment } from '/js/sanitize.js';

export interface RichTextSpec {
  /** the field's INITIAL html; never re-applied */
  value: string;
  /** fires on every input event */
  onchange: (html: string) => void;
  /** shown by CSS while the field is empty */
  placeholder?: string;
  /**
   * added to the field itself, not to the host, so a rule written against
   * `.run-notes` still lands on the editable box
   */
  extraClass?: string;
}

/**
 * @param node - the host cell; the field is APPENDED, so any text
 *   Svelte rendered into it stays in front of the field
 */
export function richtext(node: HTMLElement, spec: RichTextSpec): { destroy: () => void } {
  let field: HTMLElement | null = null;
  // The runner can be closed inside the import's round trip; without this the
  // field would be appended to a node that is already off the page.
  let live = true;

  import('/js/editor.js').then(({ richText }) => {
    if (!live) return;
    field = richText(spec.value, spec.onchange, spec.placeholder);
    if (spec.extraClass) field.classList.add(spec.extraClass);
    node.appendChild(field);
  });

  // Deliberately no `update`: see the header. Declaring one would make Svelte
  // re-read the spec and hand this action a new value to apply, which is the
  // exact behaviour the carve-out exists to prevent.
  return {
    destroy() {
      live = false;
      if (field) field.remove();
      field = null;
    },
  };
}

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
