// html.ts - tagged-template DOM builder for STATIC shape: report tables, cards,
// list items - anything that reads better as markup than as nested elem() calls.
//
// Child positions only: ${value} fills a child slot the same way dom.ts's
// append() fills one - a Node (or array of Nodes) is inserted as-is, anything
// else becomes an escaped text node, and null/undefined/false are skipped. There
// is NO attribute interpolation (`class="${x}"` will not work) - anything with a
// dynamic attribute, an event handler, or state that changes after creation
// belongs in elem() instead; build it there and pass the finished node in as a
// value.

// A slot takes exactly what an elem() child slot takes, so the two builders can
// be mixed freely in one tree; the shape is defined once, in dom.ts.
import type { Child, ChildSlot } from './dom.js';

export function html(strings: TemplateStringsArray, ...values: ChildSlot[]): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = strings.join('<!--slot-->');
  fillSlots(tpl.content, values);
  return tpl.content;
}

// Find every slot marker (in document order) and replace it with its value.
// Throws on a count mismatch rather than silently misassigning every slot after
// the gap - the near-certain cause is a ${} written inside an attribute, where
// the marker becomes literal attribute text instead of a comment node.
export function fillSlots(root: Node, values: ChildSlot[]): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const slots: Comment[] = [];
  let node: Comment;
  // SHOW_COMMENT means every node the walker hands back is a Comment.
  while ((node = walker.nextNode() as Comment)) if (node.data === 'slot') slots.push(node);
  if (slots.length !== values.length) {
    throw new Error('html: ' + values.length + ' value(s) but ' + slots.length +
      ' slot(s) found - a ${...} probably landed inside an attribute, which is not supported');
  }
  slots.forEach((slot, i) => {
    // Same nodeType probe dom.ts's isNode() uses, and for the same reason: a node
    // built in another document still has to count as one.
    const nodes = ([] as Child[]).concat(values[i]).flat(Infinity)
      .filter(v => v != null && v !== false)
      .map((v): Node => ((v as Node).nodeType ? v as Node : document.createTextNode(String(v))));
    slot.replaceWith(...nodes);
  });
}
