// md/blocks.js - PHASE 1: block structure. Produces a block tree of plain
// objects { type, children:[], ... } plus a link-reference-definition map.
// Open blocks are tracked as an array "path" from the document down to the tip.
// Also runs the block post-passes: link-ref collection, table extraction, and
// list tightness detection.
// ---------------------------------------------------------------------------
import { scanDest, scanTitle, normLabel } from './scan.js';
import { extractTables } from './tables.js';

/* ===========================================================================
   PHASE 1 - block structure
   Block object: { type, children:[], text?:string[], ... }
   =========================================================================== */
export function makeBlock(type, extra) {
  const b = { type: type, children: [], open: true, lines: [], lastLineBlank: false };
  if (extra) for (const k in extra) b[k] = extra[k];
  return b;
}

const reThematic = /^ {0,3}([-_*])(?:[ \t]*\1){2,}[ \t]*$/;
const reATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const reFence = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/;
const reBulletItem = /^( *)([-+*])( +|\t|$)(.*)$/;
const reOrderedItem = /^( *)(\d{1,9})([.)])( +|\t|$)(.*)$/;
const reBlockquote = /^ {0,3}> ?/;
const reSetext = /^ {0,3}(=+|-+)[ \t]*$/;
const reIndentedCode = /^ {4,}/;
const reBlank = /^[ \t]*$/;
const reLinkRefDef = /^ {0,3}\[/;

// HTML block start conditions (types 1-7). Returns end-detector or null.
function htmlBlockKind(line, canInterrupt) {
  const l = line.replace(/^ {0,3}/, '');
  if (/^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i.test(l)) return 1;
  if (/^<!--/.test(l)) return 2;
  if (/^<\?/.test(l)) return 3;
  if (/^<![A-Za-z]/.test(l)) return 4;
  if (/^<!\[CDATA\[/.test(l)) return 5;
  if (/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t>/]|$)/i.test(l)) return 6;
  if (!canInterrupt) {
    const OPEN = '<[A-Za-z][A-Za-z0-9-]*(?:[ \\t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \\t]*=[ \\t]*(?:[^"\'=<>`\\s]+|\'[^\']*\'|"[^"]*"))?)*[ \\t]*/?>';
    const CLOSE = '</[A-Za-z][A-Za-z0-9-]*[ \\t]*>';
    if (new RegExp('^(?:' + OPEN + '|' + CLOSE + ')[ \\t]*$').test(l)) return 7;
  }
  return 0;
}
function htmlBlockCloses(kind, line) {
  switch (kind) {
    case 1: return /<\/(?:script|pre|style|textarea)>/i.test(line);
    case 2: return /-->/.test(line);
    case 3: return /\?>/.test(line);
    case 4: return />/.test(line);
    case 5: return /\]\]>/.test(line);
    default: return false; // 6,7 close on a blank line (handled by caller)
  }
}

export function parseDocument(src) {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\0/g, '�').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  const doc = makeBlock('document');
  const refs = Object.create(null);
  let path = [doc]; // open blocks, document -> tip

  for (let li = 0; li < lines.length; li++) {
    let raw = lines[li];
    let rest = raw;               // remaining unconsumed part of the line
    let indent = 0;               // leading spaces already available
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

    const tip = path[matched - 1];
    let container = tip;
    // close deeper unmatched open containers later; for now keep the matched prefix
    // ---- 2. try to open new blocks ----
    let leaf = path[path.length - 1];
    let blockClosedLazy = false;

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

/* ---- block helpers ---- */
function leading(s) {
  let spaces = 0, i = 0, col = 0;
  while (i < s.length) {
    if (s[i] === ' ') { spaces++; col++; i++; }
    else if (s[i] === '\t') { const n = 4 - (col % 4); spaces += n; col += n; i++; }
    else break;
  }
  return { spaces: spaces, offset: i };
}
function removeIndent(s, n) {
  // remove up to n columns of leading whitespace
  let col = 0, i = 0;
  while (i < s.length && col < n) {
    if (s[i] === ' ') { col++; i++; }
    else if (s[i] === '\t') { col += 4 - (col % 4); i++; }
    else break;
  }
  return s.slice(i);
}
function removeIndentTo(s, n) { return removeIndent(s, n); }
function stripUpTo(s, n) {
  let i = 0, col = 0;
  while (i < s.length && col < n && (s[i] === ' ' || s[i] === '\t')) { col += s[i] === '\t' ? 4 - (col % 4) : 1; i++; }
  return s.slice(i);
}
// Remove exactly n columns of leading whitespace, splitting a straddling tab.
function stripCols(s, n) {
  let i = 0, col = 0;
  while (i < s.length && col < n) {
    if (s[i] === '\t') { const w = 4 - (col % 4); if (col + w <= n) { col += w; i++; } else { return ' '.repeat(col + w - n) + s.slice(i + 1); } }
    else if (s[i] === ' ') { col++; i++; }
    else break;
  }
  return s.slice(i);
}
// Expand only the LEADING run of whitespace of `s`, measuring tab stops from
// `startCol` so a tab after a list marker lands on the correct column.
function expandLeadingTabs(s, startCol) {
  let i = 0, col = startCol, out = '';
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) {
    if (s[i] === '\t') { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; }
    else { out += ' '; col++; }
    i++;
  }
  return out + s.slice(i);
}
// True when `rest` is a list marker that would continue (as a sibling item) a
// list already open in `path` - the deciding factor between "sibling item" and
// "lazy paragraph continuation" for markers that cannot otherwise interrupt a
// paragraph (e.g. an ordered marker whose number is not 1).
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
function last(b) { return b.children[b.children.length - 1]; }
function canContain(b, childType) {
  if (b.type === 'document' || b.type === 'blockquote' || b.type === 'item') return childType !== 'item';
  if (b.type === 'list') return childType === 'item';
  return false;
}
function maybeCloseParagraph(container, path) {
  if (last(container) && last(container).type === 'paragraph' && last(container).open) {
    closeBlock(last(container));
    if (path[path.length - 1].type === 'paragraph') path.pop();
  }
}
// Would `rest` begin a new block, ending the open paragraph? `interrupting` is
// true only when the paragraph is the directly-matched container - the extra
// "can't interrupt a paragraph" limits on list markers (empty content, or an
// ordered start other than 1) apply only then. When a matching list is the
// container instead, any marker of that list simply opens a sibling item.
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
function closeBlock(b) { b.open = false; }
function isRefOnly(para) {
  const text = para.lines.join('\n');
  return /^ {0,3}\[[^\]]+\]:/.test(text) && !/\n\s*\S/.test(text.replace(/^ {0,3}\[[^\]]+\]:.*$/m, ''));
}

// Peel any leading link reference definitions off a paragraph, registering
// them, and return whether inline content still remains (so the caller knows
// if there is a heading/paragraph left to build). Used when a setext underline
// arrives before the block post-pass has run.
function stripLeadingRefs(para, refs) {
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
function collectRefs(block, refs) {
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
function parseRefDef(text) {
  const m = /^ {0,3}\[/.exec(text);
  if (!m) return null;
  let i = 1, label = '', depth = 1;
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
  let url = destRes.dest; i = destRes.pos;
  // optional title (may be on next line)
  let save = i, sawSpace = false;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) { i++; sawSpace = true; }
  let newline = false;
  if (text[i] === '\n') { newline = true; i++; while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++; }
  let title = null;
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

// A block "ends with a blank line" if it, or (for lists/items) the tail of its
// last descendant, was marked by a blank line during parsing.
function tailIsBlank(block) {
  let b = block, guard = 0;
  while (b && ++guard < 1000) {
    if (b.lastLineBlank) return true;
    if (b.type === 'list' || b.type === 'item') b = b.children[b.children.length - 1];
    else return false;
  }
  return false;
}
function detectTightness(block) {
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
