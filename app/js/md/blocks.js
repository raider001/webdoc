// md/blocks.js - PHASE 1 block structure: the line-by-line parse loop
// (parseDocument) building a block tree of { type, children:[], ... } objects +
// a link-reference-definition map, with open blocks tracked as a "path" array
// from the document to the tip. Scanning primitives -> ./patterns.js; post-passes
// (ref-def collection + list tightness) -> ./blockpost.js; GFM tables -> ./tables.js.
// ---------------------------------------------------------------------------
import {
  reThematic, reATX, reFence, reBulletItem, reOrderedItem, reBlockquote, reSetext, reBlank,
  htmlBlockKind, htmlBlockCloses,
  leading, removeIndent, stripUpTo, stripCols, expandLeadingTabs
} from './patterns.js';
import { stripLeadingRefs, collectRefs, detectTightness } from './blockpost.js';
import { extractTables } from './tables.js';

/* ===========================================================================
   PHASE 1 - block structure
   Block object: { type, children:[], text?:string[], ... }
   =========================================================================== */

/**
 * The CommonMark/GFM block-tree node built by makeBlock() during PHASE 1
 * parsing; walked by the ref-def and tightness post-passes (./blockpost.js),
 * rewritten in place by the GFM table pass (./tables.js), and read leaf-by-leaf
 * by the PHASE 2 HTML renderer (./render.js, ../commonmark.js). Deliberately
 * distinct from the unrelated app/js/blocks.js fenced-block renderer registry.
 * @typedef {Object} MdBlockNode
 * @property {string} type
 * @property {MdBlockNode[]} children
 * @property {boolean} open
 * @property {string[]} lines
 * @property {boolean} lastLineBlank
 * @property {number} [level] - heading only
 * @property {string} [listType] - 'ordered'|'bullet', list only
 * @property {string|number} [marker] - list: bullet char; item: content-indent column
 * @property {number|null} [start] - list only; always present on list nodes, but only meaningful (non-null) when listType is 'ordered'
 * @property {boolean} [tight] - list only
 * @property {string} [taskPrefix] - paragraph only, GFM task-list checkbox HTML
 * @property {string|number} [kind] - codeblock: 'fenced'|'indented'; htmlblock: 1-7
 * @property {string} [fence] - fenced codeblock only
 * @property {number} [fenceLen] - fenced codeblock only
 * @property {number} [fenceIndent] - fenced codeblock only
 * @property {string} [info] - fenced codeblock only
 * @property {(string|null)[]} [aligns] - table only
 * @property {string[]} [headerCells] - table only
 * @property {string[][]} [bodyRows] - table only
 * @property {number} [openedLine] - item only
 */

/**
 * @param {string} type
 * @param {Object<string, *>} [extra] - extra fields merged onto the new node (e.g. level, kind, marker)
 * @returns {MdBlockNode}
 */
export function makeBlock(type, extra) {
  const b = { type: type, children: [], open: true, lines: [], lastLineBlank: false };
  if (extra) for (const k in extra) b[k] = extra[k];
  return b;
}

/**
 * The {doc, refs} pair tying the finished MdBlockNode tree to its
 * link-reference-definition table; destructured by commonmark.js's public
 * renderMarkdown() before rendering.
 * @typedef {Object} ParsedDocument
 * @property {MdBlockNode} doc
 * @property {Object<string, import('./blockpost.js').RefDefinition>} refs
 */

/**
 * PHASE 1 entry point: parse Markdown source into a block tree + ref-def table.
 * @param {string} src
 * @returns {ParsedDocument}
 */
export function parseDocument(src) {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\0/g, '�').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  const doc = makeBlock('document');
  const refs = Object.create(null);
  let path = [doc]; // open blocks, document -> tip

  for (let li = 0; li < lines.length; li++) {
    let raw = lines[li];
    let rest = raw;               // remaining unconsumed part of the line
    let matched = 1;              // how many open blocks continue
    // Fresh line: every still-open block no longer "ends with a blank line".
    // markBlank() re-sets this for the blocks a blank line actually affects.
    for (const b of path) b.lastLineBlank = false;

    // Expand leading indentation tabs to spaces on absolute 4-column tab stops
    // so all downstream block-structure logic sees consistent columns. Skipped
    // when the deepest open block is verbatim (fenced code / HTML) where the
    // exact tab bytes of a content line must be preserved.
    {
      const tipNow = path[path.length - 1];
      const verbatim = (tipNow.type === 'codeblock' && tipNow.kind === 'fenced') || tipNow.type === 'htmlblock';
      if (!verbatim) { rest = expandLeadingTabs(rest, 0); raw = rest; }
    }

    // ---- 1. match existing open containers ----
    for (let d = 1; d < path.length; d++) {
      const b = path[d];
      if (b.type === 'blockquote') {
        const m = leading(rest);
        if (m.spaces <= 3 && rest[m.offset] === '>') {
          // Drop the '>' and one optional space of padding. A tab after '>' is
          // expanded from its real column so inner indentation keeps tab-stop
          // width (`>\t\tfoo` -> two-space-indented code, not a raw tab).
          let after = expandLeadingTabs(rest.slice(m.offset + 1), m.spaces + 1);
          if (after[0] === ' ') after = after.slice(1);
          rest = after;
          matched = d + 1;
        } else break;
      } else if (b.type === 'item') {
        const m = leading(rest);
        if (reBlank.test(rest)) {
          // An item that is still empty cannot be continued by a blank line -
          // the blank ends it (`-` on its own, then a blank line).
          if (b.children.length === 0) break;
          matched = d + 1; rest = rest.replace(/^[ \t]*/, '');
        }
        else if (m.spaces >= b.marker) { rest = removeIndent(rest, b.marker); matched = d + 1; }
        else break;
      } else if (b.type === 'list' || b.type === 'document') {
        matched = d + 1;
      } else {
        break; // leaf blocks handled below
      }
    }

    let container = path[matched - 1];
    // close deeper unmatched open containers later; for now keep the matched prefix
    // ---- 2. try to open new blocks ----
    let leaf = path[path.length - 1];

    // Setext heading: an underline under an open (non-empty) paragraph converts it.
    if (matched === path.length - 1 && path[path.length - 1].type === 'paragraph' &&
        leading(rest).spaces <= 3 && reSetext.test(rest) && !isRefOnly(path[path.length - 1]) &&
        path[path.length - 1].lines.join('').trim() !== '') {
      const para = path[path.length - 1];
      // Strip any leading link reference definitions first; only what remains
      // becomes the heading text (e.g. `[foo]: /url` then `bar` then `===`).
      if (stripLeadingRefs(para, refs)) {
        para.type = 'heading';
        para.level = rest.replace(/^ {0,3}/, '')[0] === '=' ? 1 : 2;
        para.open = false;
      }
      path.pop();
      continue;
    }

    // Lazy continuation: paragraph continuation text across an unmatched container.
    // A marker that continues an already-open list of the same kind is NOT lazy
    // continuation - it opens a sibling item (even for ordered start != 1).
    if (matched < path.length && leaf.type === 'paragraph' && !reBlank.test(rest) &&
        !startsNewBlock(rest, leaf, matched === path.length - 1) && !continuesOpenList(rest, path)) {
      leaf.lines.push(rest.replace(/^ {0,3}/, ''));
      continue;
    }

    // Keep an open leaf block (fenced/indented code, HTML block) that continues here.
    {
      const tipB = path[path.length - 1];
      // Only keep an open verbatim leaf going when ALL of its ancestors still
      // match this line (matched reaches its parent). If an ancestor - e.g. a
      // block quote or list item - did not continue, the leaf closes with it.
      if (matched === path.length - 1) {
        if (tipB.type === 'codeblock') {
          if (tipB.kind === 'fenced') matched = path.length;
          else if (leading(rest).spaces >= 4 || reBlank.test(rest)) matched = path.length;
        } else if (tipB.type === 'htmlblock') {
          if (!(tipB.kind >= 6 && reBlank.test(rest))) matched = path.length;
        }
      }
    }

    // Close unmatched open blocks (from tip down)
    while (path.length > matched) closeBlock(path.pop());
    container = path[path.length - 1];

    // Now try to start new container/leaf blocks on `rest`
    let opened = true, openGuard = 0, lineConsumed = false;
    while (opened) {
      if (++openGuard > 60) break;
      opened = false;
      if (container.type === 'codeblock' || container.type === 'htmlblock') break;

      const lead = leading(rest);
      const sp = lead.spaces;

      // A list only holds items. If this line doesn't start an item of the
      // current list, close the list and continue in its parent - so a heading,
      // code block, quote, etc. after a list is a sibling, not swallowed by it.
      if (container.type === 'list') {
        const im = reBulletItem.exec(rest) || reOrderedItem.exec(rest);
        let matchesItem = false;
        // A thematic break takes precedence over a list item (`* * *` is an
        // <hr>, not a `*` item), so it ends the list rather than continuing it.
        if (im && sp <= 3 && !reThematic.test(rest)) {
          const ord = im.length === 6;
          const mk = ord ? im[3] : im[2];
          matchesItem = container.listType === (ord ? 'ordered' : 'bullet') && container.marker === mk;
        }
        // A blank line does not close a list - it may sit between items. Only a
        // non-blank line that is not a matching item ends the list.
        if (!matchesItem && !reBlank.test(rest)) { closeBlock(path.pop()); container = path[path.length - 1]; }
      }

      // indented code (only if not able to be lazy paragraph and container can hold)
      if (sp >= 4 && container.type !== 'paragraph' && canContain(container, 'codeblock')) {
        const cb = makeBlock('codeblock', { kind: 'indented' });
        cb.lines.push(stripCols(rest, 4));
        container.children.push(cb); path.push(cb);
        rest = ''; lineConsumed = true; break;
      }

      if (sp <= 3) {
        const body = rest.slice(sp);
        // thematic break
        if (reThematic.test(rest)) {
          maybeCloseParagraph(container, path);
          container = path[path.length - 1];
          container.children.push(makeBlock('thematic', { open: false }));
          rest = ''; lineConsumed = true; break;
        }
        // ATX heading
        let am = /^ {0,3}(#{1,6})(?=[ \t]|$)([^\n]*)$/.exec(rest);
        if (am) {
          let content = am[2].replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
          content = content.replace(/(?:^|[ \t])#+[ \t]*$/, '').replace(/[ \t]+$/, '');
          maybeCloseParagraph(container, path);
          container = path[path.length - 1];
          const h = makeBlock('heading', { level: am[1].length, open: false });
          h.lines.push(content);
          container.children.push(h);
          rest = ''; lineConsumed = true; break;
        }
        // fenced code (a backtick fence's info string may not contain a
        // backtick - `` ``` ``` `` is a code span, not a fence)
        let m = reFence.exec(rest);
        if (m && canContain(container, 'codeblock') && !(m[2][0] === '`' && m[3].indexOf('`') !== -1)) {
          maybeCloseParagraph(container, path);
          container = path[path.length - 1];
          const cb = makeBlock('codeblock', { kind: 'fenced', fence: m[2][0], fenceLen: m[2].length, fenceIndent: m[1].length, info: m[3].trim() });
          container.children.push(cb); path.push(cb);
          rest = ''; lineConsumed = true; break;
        }
        // blockquote
        if (reBlockquote.test(rest)) {
          const bq = makeBlock('blockquote');
          container.children.push(bq); path.push(bq);
          container = bq;
          // strip '>' + one optional space, expanding a trailing tab from its
          // real column (mirrors the continuation logic above).
          const bm = leading(rest);
          let after = expandLeadingTabs(rest.slice(bm.offset + 1), bm.spaces + 1);
          if (after[0] === ' ') after = after.slice(1);
          rest = after;
          opened = true; continue;
        }
        // HTML block
        const kind = htmlBlockKind(rest, container.type === 'paragraph');
        if (kind) {
          if (!(kind === 7 && container.type === 'paragraph')) {
            maybeCloseParagraph(container, path);
            container = path[path.length - 1];
            const hb = makeBlock('htmlblock', { kind: kind });
            hb.lines.push(rest);
            container.children.push(hb); path.push(hb);
            if (htmlBlockCloses(kind, rest) || (kind >= 6 && false)) closeBlock(path.pop());
            rest = ''; lineConsumed = true; break;
          }
        }
        // setext heading (underline for an open paragraph)
        if (reSetext.test(rest) && container.type !== 'document' && last(container) && last(container).type === 'paragraph' && last(container).open && !isRefOnly(last(container))) {
          const para = last(container);
          if (stripLeadingRefs(para, refs)) {
            para.type = 'heading';
            para.level = body[0] === '=' ? 1 : 2;
            para.open = false;
          }
          rest = ''; lineConsumed = true; break;
        }
        // list item
        let bm = reBulletItem.exec(rest) || reOrderedItem.exec(rest);
        if (bm) {
          const isOrdered = bm.length === 6;
          const markerCh = isOrdered ? bm[3] : bm[2];
          const num = isOrdered ? parseInt(bm[2], 10) : null;
          const leadSp = bm[1].length;
          const markerChars = isOrdered ? bm[2].length + 1 : 1; // digits + delimiter, or the bullet
          const col0 = leadSp + markerChars;                    // column just past the marker char
          // Content after the marker char, with any tab right after the marker
          // expanded to spaces relative to its real column (so `-\tfoo` counts
          // as list indentation, never an indented code block).
          const contentRaw = expandLeadingTabs(rest.slice(col0), col0);
          const blankContent = /^ *$/.test(contentRaw);
          // Don't interrupt a paragraph with an empty list item or ordered start != 1
          if (container.type === 'paragraph' || (last(container) && last(container).type === 'paragraph' && last(container).open)) {
            if (blankContent) break;
            if (isOrdered && num !== 1) break;
          }
          let n; // columns of content indentation relative to the marker char
          if (blankContent) n = 1;
          else {
            const wsp = contentRaw.length - contentRaw.replace(/^ +/, '').length;
            n = (wsp >= 1 && wsp <= 4) ? wsp : 1; // >4 leaves the rest as inner indented code
          }
          const contentIndent = leadSp + markerChars + n;
          const wantType = isOrdered ? 'ordered' : 'bullet';
          // A different list type/marker ends the current list; the new one is a
          // sibling of it, not a child - otherwise the old list swallows it.
          if (container.type === 'list' && !(container.listType === wantType && container.marker === markerCh)) {
            closeBlock(path.pop());
            container = path[path.length - 1];
          }
          if (!(container.type === 'list' && container.listType === wantType && container.marker === markerCh)) {
            const nl = makeBlock('list', { listType: wantType, marker: markerCh, start: isOrdered ? num : null, tight: true, listItemGap: false });
            container.children.push(nl); path.push(nl); container = nl;
          }
          const item = makeBlock('item', { marker: contentIndent, openedLine: li });
          container.children.push(item); path.push(item); container = item;
          rest = blankContent ? '' : contentRaw.slice(n);
          opened = true; continue;
        }
      }
      break;
    }

    if (lineConsumed) continue;

    // ---- 3. attach remaining text to the current leaf ----
    container = path[path.length - 1];
    if (rest === '' && container.type !== 'codeblock' && container.type !== 'htmlblock') {
      // blank line
      markBlank(path, li);
      continue;
    }

    const cur = path[path.length - 1];
    if (cur.type === 'codeblock') {
      if (cur.kind === 'fenced') {
        const cm = new RegExp('^ {0,3}' + cur.fence + '{' + cur.fenceLen + ',}[ \\t]*$');
        if (cm.test(rest) && rest.replace(/^ {0,3}/, '')[0] === cur.fence) { closeBlock(path.pop()); }
        else cur.lines.push(stripUpTo(rest, cur.fenceIndent));
      } else {
        cur.lines.push(stripCols(rest, 4));
      }
    } else if (cur.type === 'htmlblock') {
      cur.lines.push(rest);
      if (htmlBlockCloses(cur.kind, rest)) closeBlock(path.pop());
    } else if (cur.type === 'paragraph') {
      cur.lines.push(rest.replace(/^ {0,3}/, ''));
    } else if (cur.type === 'heading') {
      // already consumed
    } else {
      // start a paragraph
      const p = makeBlock('paragraph');
      p.lines.push(rest.replace(/^ {0,3}/, ''));
      cur.children.push(p); path.push(p);
    }
  }
  while (path.length) closeBlock(path.pop());

  // collect link reference definitions from paragraphs
  collectRefs(doc, refs);
  extractTables(doc);
  detectTightness(doc);
  return { doc, refs };
}

/* ---- parser-state helpers (tightly bound to parseDocument) ---- */
/** @param {MdBlockNode} b @returns {MdBlockNode|undefined} */
function last(b) { return b.children[b.children.length - 1]; }
/**
 * @param {MdBlockNode} b
 * @param {string} childType
 * @returns {boolean}
 */
function canContain(b, childType) {
  if (b.type === 'document' || b.type === 'blockquote' || b.type === 'item') return childType !== 'item';
  if (b.type === 'list') return childType === 'item';
  return false;
}
/**
 * @param {MdBlockNode} container
 * @param {MdBlockNode[]} path - open blocks, document -> tip
 * @returns {void}
 */
function maybeCloseParagraph(container, path) {
  if (last(container) && last(container).type === 'paragraph' && last(container).open) {
    closeBlock(last(container));
    if (path[path.length - 1].type === 'paragraph') path.pop();
  }
}
/**
 * Would `rest` begin a new block, ending the open paragraph? `interrupting` is
 * true only when the paragraph is the directly-matched container - the extra
 * "can't interrupt a paragraph" limits on list markers (empty content, or an
 * ordered start other than 1) apply only then. When a matching list is the
 * container instead, any marker of that list simply opens a sibling item.
 * @param {string} rest
 * @param {MdBlockNode} leaf - the open paragraph
 * @param {boolean} interrupting
 * @returns {boolean}
 */
function startsNewBlock(rest, leaf, interrupting) {
  const sp = leading(rest).spaces;
  if (sp >= 4) return false; // indented code can't interrupt a paragraph
  if (reThematic.test(rest)) return true;
  if (reATX.test(rest)) return true;
  if (reFence.test(rest)) return true;
  if (reBlockquote.test(rest)) return true;
  if (htmlBlockKind(rest, true)) return true;
  const bm = reBulletItem.exec(rest) || reOrderedItem.exec(rest);
  if (bm) {
    const isOrdered = bm.length === 6;
    const content = isOrdered ? bm[5] : bm[4];
    if (interrupting) {
      if (reBlank.test(content)) return false;
      if (isOrdered && parseInt(bm[2], 10) !== 1) return false;
    }
    return true;
  }
  return false;
}
/**
 * True when `rest` is a list marker that would continue (as a sibling item) a
 * list already open in `path` - the deciding factor between "sibling item" and
 * "lazy paragraph continuation" for markers that cannot otherwise interrupt a
 * paragraph (e.g. an ordered marker whose number is not 1).
 * @param {string} rest
 * @param {MdBlockNode[]} path - open blocks, document -> tip
 * @returns {boolean}
 */
function continuesOpenList(rest, path) {
  if (leading(rest).spaces >= 4) return false;
  const bm = reBulletItem.exec(rest) || reOrderedItem.exec(rest);
  if (!bm) return false;
  const isOrdered = bm.length === 6;
  const content = isOrdered ? bm[5] : bm[4];
  if (reBlank.test(content)) return false; // an empty item never continues a paragraph
  const markerCh = isOrdered ? bm[3] : bm[2];
  const wantType = isOrdered ? 'ordered' : 'bullet';
  for (const b of path) {
    if (b.type === 'list' && b.listType === wantType && b.marker === markerCh) return true;
  }
  return false;
}
/**
 * @param {MdBlockNode[]} path - open blocks, document -> tip
 * @param {number} lineNo
 * @returns {void}
 */
function markBlank(path, lineNo) {
  const leaf = path[path.length - 1];
  if (leaf.type === 'paragraph') { closeBlock(path.pop()); }
  const container = path[path.length - 1];
  // The child that a blank line lands after is recorded as ending with a blank
  // line - that is the signal a following block makes the enclosing list loose.
  const lc = container.children[container.children.length - 1];
  if (lc) lc.lastLineBlank = true;
  // Propagate to the container and its ancestors, except where a blank line does
  // not count: inside a block quote, or a list item freshly opened empty on this
  // same line (`-` alone).
  let val = true;
  const t = container.type;
  if (t === 'blockquote') val = false;
  else if (t === 'item' && container.children.length === 0 && container.openedLine === lineNo) val = false;
  for (const b of path) b.lastLineBlank = val;
}
/** @param {MdBlockNode} b @returns {void} */
function closeBlock(b) { b.open = false; }
/**
 * @param {MdBlockNode} para
 * @returns {boolean} true if the paragraph is nothing but link reference definition(s)
 */
function isRefOnly(para) {
  const text = para.lines.join('\n');
  return /^ {0,3}\[[^\]]+\]:/.test(text) && !/\n\s*\S/.test(text.replace(/^ {0,3}\[[^\]]+\]:.*$/m, ''));
}
