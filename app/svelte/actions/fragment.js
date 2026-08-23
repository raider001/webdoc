// fragment.js - `use:fragment={{text}}` renders AUTHORED MARKDOWN into an
// otherwise-empty element, as plain non-Svelte DOM.
//
// THE LINE THIS ACTION DRAWS, and the reason it exists at all:
//
//   Svelte owns the table STRUCTURE. It does not own the prose inside a cell.
//
// A requirement's description and a test step's action/expected are Markdown
// written by a document author. Rendering them as `{text}` would show the
// literal source ("`a` **b**"), and rendering them with {@html} would hand the
// document a raw-HTML channel that bypasses app/js/sanitize.js - the one place
// in the product allowed to produce trusted markup, and the reason eslint bans
// {@html} anywhere under app/svelte/. So the markdown keeps going through
// requirements/render.js's blockMarkdown / inlineMarkdown, which are unchanged:
// commonmark -> SANITIZER -> DocumentFragment. This action only appends what
// they returned.
//
// Keeping the result as ordinary DOM is also what lets the rest of the pipeline
// carry on working. reader.js runs renderBlocks() and highlightWithin() over the
// whole article AFTER the tables are mounted, and both MUTATE the nodes they
// find - a highlighter rewriting the innards of a <code> block inside a test
// step, for instance. Svelte-rendered text would be reverted by the component's
// next update; text this action placed simply stays put, because nothing
// re-renders it (see the guard in render(), below).
import { blockMarkdown, inlineMarkdown } from '/js/requirements/render.js';

/**
 * What to render, and how.
 * @typedef {Object} FragmentSpec
 * @property {string} text - raw Markdown, exactly as the author wrote it
 * @property {boolean} [inline] - true for a single-line context (a requirement
 *   description): inline constructs only, no wrapping <p>. Block by default,
 *   because a test step may be a list or a code block.
 */

/**
 * @param {HTMLElement} node - the cell to fill; assumed to have no other children
 * @param {FragmentSpec} spec
 * @returns {{update: (spec: FragmentSpec) => void, destroy: () => void}}
 */
export function fragment(node, spec) {
  /**
   * The top-level nodes this action put in place. Tracked because a
   * DocumentFragment is EMPTIED by appendChild - the fragment object itself is
   * useless afterwards - so the only way to take the content out again is to
   * have kept the children.
   * @type {ChildNode[]}
   */
  let placed = [];
  /**
   * The spec `placed` was rendered from, by VALUE. See the guard below.
   * @type {FragmentSpec|null}
   */
  let shown = null;

  /**
   * @param {FragmentSpec} next
   * @returns {void}
   */
  function render(next) {
    const text = String((next && next.text) || '');
    const inline = !!(next && next.inline);
    // Compare CONTENT, not identity. `use:fragment={{text: s.action}}` is a
    // fresh object literal on every re-render of the surrounding block, so an
    // identity check would re-render the markdown each time a sibling changed -
    // and re-rendering it would silently discard whatever highlightWithin() had
    // done to it. The text of a rendered document never changes without a new
    // document, so this guard makes the common case a no-op.
    if (shown && shown.text === text && shown.inline === inline) return;
    placed.forEach(n => n.remove());
    const frag = inline ? inlineMarkdown(text) : blockMarkdown(text);
    placed = [...frag.childNodes];
    node.appendChild(frag);
    shown = { text: text, inline: inline };
  }

  render(spec);
  return {
    update: render,
    // The host cell is usually being removed anyway, but a component can be
    // unmounted while its target stays (islands/requirements.js unmounts into a
    // host reader.js then discards), and leaving orphaned prose behind in a cell
    // Svelte believes it has emptied is exactly the kind of ghost this whole
    // teardown discipline exists to prevent.
    destroy: () => { placed.forEach(n => n.remove()); placed = []; shown = null; },
  };
}
