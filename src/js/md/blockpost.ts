// md/blockpost.ts - the block-tree post-passes run after the line loop in
// ./blocks.js: (1) link-reference-definition collection - peel `[label]: url
// "title"` definitions off the fronts of paragraphs and register them; and
// (2) list-tightness detection - decide which lists render loose (blank line
// inside) vs tight. Extracted from blocks.js. Uses the link scanners in ./scan.js.
// ---------------------------------------------------------------------------
import { scanDest, scanTitle, normLabel } from './scan.js';
import type { MdBlockNode, MdParagraphBlock } from './blocks.js';

/**
 * One resolved link-reference-definition (`[label]: url "title"`), stored in
 * the refs map keyed by normalized label; looked up in md/inline.js when a
 * reference-style link/image `[text][label]` is closed.
 */
export interface RefDefinition {
  url: string;
  title: string | null;
}

/**
 * Peel any leading link reference definitions off a paragraph, registering
 * them, and return whether inline content still remains (so the caller knows
 * if there is a heading/paragraph left to build). Used when a setext underline
 * arrives before the block post-pass has run.
 */
export function stripLeadingRefs(para: MdParagraphBlock, refs: Record<string, RefDefinition>): boolean {
  let text = para.lines.join('\n');
  let consumed = true, guard = 0;
  while (consumed && ++guard < 200) {
    consumed = false;
    const parsed = parseRefDef(text);
    if (parsed) {
      if (!(normLabel(parsed.label) in refs)) refs[normLabel(parsed.label)] = { url: parsed.url, title: parsed.title };
      text = parsed.rest;
      consumed = true;
    }
  }
  para.lines = text === '' ? [] : text.split('\n');
  if (text === '') para.type = 'empty';
  return text !== '';
}
/**
 * Walk the block tree collecting link reference definitions from paragraphs
 * (same peeling logic as stripLeadingRefs, applied tree-wide after the line loop).
 */
export function collectRefs(block: MdBlockNode, refs: Record<string, RefDefinition>): void {
  for (const child of block.children) {
    if (child.type === 'paragraph') {
      let text = child.lines.join('\n');
      let consumed = true;
      while (consumed) {
        consumed = false;
        const parsed = parseRefDef(text);
        if (parsed) {
          if (!(normLabel(parsed.label) in refs)) refs[normLabel(parsed.label)] = { url: parsed.url, title: parsed.title };
          text = parsed.rest;
          consumed = true;
        }
      }
      child.lines = text === '' ? [] : text.split('\n');
      if (text === '') child.type = 'empty';
    } else if (child.children && child.children.length) {
      collectRefs(child, refs);
    }
  }
}

interface RefDefParse {
  /** raw (unescaped) label text between the brackets */
  label: string;
  url: string;
  title: string | null;
  /** remaining source text after this definition (and its trailing newline) */
  rest: string;
}

function parseRefDef(text: string): RefDefParse | null {
  const m = /^ {0,3}\[/.exec(text);
  if (!m) return null;
  let i = 1, label = '';
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) { label += c + text[i + 1]; i += 2; continue; }
    if (c === ']') { i++; break; }
    if (c === '[') return null;
    label += c; i++;
  }
  if (text[i] !== ':') return null;
  if (label.trim() === '') return null;
  i++;
  // optional whitespace incl up to one newline
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  if (text[i] === '\n') { i++; while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++; }
  // destination
  const destRes = scanDest(text, i);
  if (!destRes) return null;
  const url = destRes.dest; i = destRes.pos;
  // optional title (may be on next line)
  const save = i;
  let sawSpace = false;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) { i++; sawSpace = true; }
  let newline = false;
  if (text[i] === '\n') { newline = true; i++; while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++; }
  let title: string | null = null;
  const titleRes = (sawSpace || newline) ? scanTitle(text, i) : null;
  if (titleRes) { title = titleRes.title; i = titleRes.pos; }
  else i = save;
  // rest of the line must be blank
  let j = i;
  while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
  if (j < text.length && text[j] !== '\n') {
    if (title !== null) { /* title made the line non-blank: retry without title */ title = null; i = save; j = i; while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++; if (j < text.length && text[j] !== '\n') return null; }
    else return null;
  }
  const rest = text.slice(j).replace(/^\n/, '');
  return { label: label, url: url, title: title, rest: rest };
}

/**
 * A block "ends with a blank line" if it, or (for lists/items) the tail of its
 * last descendant, was marked by a blank line during parsing.
 */
function tailIsBlank(block: MdBlockNode): boolean {
  let b = block, guard = 0;
  while (b && ++guard < 1000) {
    if (b.lastLineBlank) return true;
    if (b.type === 'list' || b.type === 'item') b = b.children[b.children.length - 1];
    else return false;
  }
  return false;
}
/**
 * Walk the block tree, deciding which lists render tight vs loose.
 */
export function detectTightness(block: MdBlockNode): void {
  for (const child of block.children) {
    if (child.type === 'list') {
      let tight = true;
      const items = child.children;
      for (let i = 0; i < items.length && tight; i++) {
        const item = items[i];
        // a non-final item ending with a blank line makes the list loose
        if (tailIsBlank(item) && i < items.length - 1) { tight = false; break; }
        // a blank line between two blocks within an item makes it loose
        const subs = item.children;
        for (let k = 0; k < subs.length; k++) {
          if (tailIsBlank(subs[k]) && (i < items.length - 1 || k < subs.length - 1)) { tight = false; break; }
        }
      }
      child.tight = tight;
    }
    if (child.children && child.children.length) detectTightness(child);
  }
}
