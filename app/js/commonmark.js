// commonmark.js - a from-scratch Markdown engine targeting CommonMark 0.31.2 + GFM.
// Public entry point. The engine is split into cohesive modules under ./md/:
//   md/text.js    - escaping, HTML entities, URI normalization
//   md/scan.js    - link destination / title / bracket-label scanners
//   md/blocks.js  - PHASE 1: block structure (+ ref-def, table, tightness passes)
//   md/inline.js  - inline parsing (emphasis, links, images, code, autolinks, ...)
//   md/render.js  - PHASE 2: block tree -> HTML string
//   md/tables.js  - GFM tables (block post-pass + rendering)
// ---------------------------------------------------------------------------
// Written independently from the CommonMark specification (not ported from any
// implementation). Architecture is my own:
//   * the block tree is plain objects { type, children: [], ... } with ARRAY
//     children (no linked-list nodes / sibling pointers);
//   * open blocks are tracked as a simple array "path" from the document down
//     to the deepest open block;
//   * inline parsing builds an ARRAY of pieces and resolves emphasis over that
//     array with an array-indexed delimiter list, then serialises to HTML.
// The algorithms it implements (two-phase parsing, the emphasis rule, the HTML
// grammar) are those described in the spec; the code expressing them is mine.
// ---------------------------------------------------------------------------
import { parseDocument } from './md/blocks.js';
import { renderTree } from './md/render.js';
import { parseInlines } from './md/inline.js';

export const INTERIM = false;

/* ===========================================================================
   Public entry
   =========================================================================== */

/**
 * Parse and render a full Markdown document to an HTML string.
 * @param {string} src
 * @returns {string}
 */
export function renderMarkdown(src) {
  const { doc, refs } = parseDocument(String(src));
  let html = renderTree(doc, refs);
  return html;
}

/**
 * Render INLINE markdown only (code spans, emphasis, links) — no block
 * constructs. Used for table-cell content such as requirement descriptions and
 * test-case action / expected-response steps, which are inline contexts.
 * @param {string} [src]
 * @returns {string}
 */
export function renderInline(src) {
  return parseInlines(String(src == null ? '' : src), Object.create(null));
}
