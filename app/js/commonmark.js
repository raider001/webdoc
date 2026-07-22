// commonmark.js - a from-scratch Markdown engine targeting CommonMark 0.31.2 + GFM.
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

export const INTERIM = false;

/* ===========================================================================
   Escaping / small helpers
   =========================================================================== */
const AMP = /[&<>"]/;
function esc(s) {
  if (!AMP.test(s)) return s;
  return s.replace(/[&<>"]/g, c =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;');
}
function expandTabs(line) {
  // Expand tabs to the next 4-column stop (for the whole line; content-preserving
  // where tabs are inside code is handled by the block logic separately).
  if (line.indexOf('\t') === -1) return line;
  let out = '', col = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\t') { const n = 4 - (col % 4); out += ' '.repeat(n); col += n; }
    else { out += ch; col++; }
  }
  return out;
}

/* ===========================================================================
   Entities (a representative HTML5 named set + all numeric forms)
   =========================================================================== */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©',
  reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«',
  raquo: '»', deg: '°', plusmn: '±', times: '×', divide: '÷',
  frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³',
  micro: 'µ', para: '¶', middot: '·', cent: '¢', pound: '£',
  euro: '€', yen: '¥', sect: '§', dagger: '†', Dagger: '‡',
  bull: '•', prime: '′', Prime: '″', alpha: 'α', beta: 'β',
  gamma: 'γ', delta: 'δ', pi: 'π', sigma: 'σ', omega: 'ω',
  infin: '∞', ne: '≠', le: '≤', ge: '≥', larr: '←',
  rarr: '→', uarr: '↑', darr: '↓', harr: '↔', spades: '♠',
  clubs: '♣', hearts: '♥', diams: '♦', check: '✓', cross: '✗',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö',
  Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', agrave: 'à',
  ccedil: 'ç', ntilde: 'ñ', aacute: 'á', iacute: 'í', oacute: 'ó',
  uacute: 'ú', shy: '­', ensp: ' ', emsp: ' ', thinsp: ' ',
  zwnj: '‌', zwj: '‍', star: '☆', quot_: '"',
  // Extended HTML5 named references (accented Latin letters, ligatures, and a
  // range of technical/mathematical symbols) - a broader slice of the standard
  // named-character-reference set than the common subset above.
  AElig: 'Æ', aelig: 'æ', Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Atilde: 'Ã',
  Aring: 'Å', Ccedil: 'Ç', Eacute: 'É', Egrave: 'È', Ecirc: 'Ê',
  Euml: 'Ë', Iacute: 'Í', Igrave: 'Ì', Icirc: 'Î', Iuml: 'Ï', Ntilde: 'Ñ',
  Oacute: 'Ó', Ograve: 'Ò', Ocirc: 'Ô', Otilde: 'Õ', Oslash: 'Ø',
  Uacute: 'Ú', Ugrave: 'Ù', Ucirc: 'Û', Yacute: 'Ý', THORN: 'Þ',
  ETH: 'Ð', eth: 'ð', thorn: 'þ', yacute: 'ý', yuml: 'ÿ', oslash: 'ø',
  acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û', atilde: 'ã',
  otilde: 'õ', aring: 'å', euml: 'ë', iuml: 'ï', igrave: 'ì', ograve: 'ò',
  ugrave: 'ù', Dcaron: 'Ď', dcaron: 'ď',
  HilbertSpace: 'ℋ', DifferentialD: 'ⅆ', ClockwiseContourIntegral: '∲',
  ngE: '≧̸', sum: '∑', prod: '∏', int: '∫', part: '∂', nabla: '∇',
  forall: '∀', exist: '∃', isin: '∈', notin: '∉', equiv: '≡', asymp: '≈',
  oplus: '⊕', otimes: '⊗', perp: '⊥', sdot: '⋅', real: 'ℜ', image: 'ℑ',
  weierp: '℘', aleph: 'ℵ', oline: '‾', frasl: '⁄', lceil: '⌈', rceil: '⌉',
  lfloor: '⌊', rfloor: '⌋', lang: '⟨', rang: '⟩', loz: '◊'
};
const ENTITY_RE = /^&(#[Xx][0-9A-Fa-f]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{0,31});/;
function decodeEntity(m) {
  const body = m.slice(1, -1);
  if (body[0] === '#') {
    let cp;
    if (body[1] === 'x' || body[1] === 'X') cp = parseInt(body.slice(2), 16);
    else cp = parseInt(body.slice(1), 10);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�';
    try { return String.fromCodePoint(cp); } catch (e) { return '�'; }
  }
  return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : null;
}
// Decode entities + backslash escapes in a raw string (used for text runs).
const ESCAPABLE = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
function decodeInlineText(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && ESCAPABLE.indexOf(s[i + 1]) !== -1) {
      out += s[i + 1]; i++;
    } else if (c === '&') {
      const m = ENTITY_RE.exec(s.slice(i));
      if (m) { const d = decodeEntity(m[0]); if (d !== null) { out += d; i += m[0].length - 1; continue; } }
      out += c;
    } else out += c;
  }
  return out;
}

/* ===========================================================================
   PHASE 1 - block structure
   Block object: { type, children:[], text?:string[], ... }
   =========================================================================== */
function makeBlock(type, extra) {
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

function parseDocument(src) {
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
function scanDest(text, i) {
  if (text[i] === '<') {
    let j = i + 1, dest = '';
    while (j < text.length) {
      const c = text[j];
      if (c === '\n' || c === '<') return null;
      if (c === '\\' && j + 1 < text.length) { dest += c + text[j + 1]; j += 2; continue; }
      if (c === '>') return { dest: dest, pos: j + 1 };
      dest += c; j++;
    }
    return null;
  }
  let j = i, dest = '', depth = 0;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\' && j + 1 < text.length) { dest += c + text[j + 1]; j += 2; continue; }
    if (c === '(') { depth++; dest += c; j++; continue; }
    if (c === ')') { if (depth === 0) break; depth--; dest += c; j++; continue; }
    if (c === ' ' || c === '\t' || c === '\n' || c.charCodeAt(0) < 0x20) break;
    dest += c; j++;
  }
  if (dest === '') return null;
  return { dest: dest, pos: j };
}
function scanTitle(text, i) {
  const open = text[i];
  if (open !== '"' && open !== "'" && open !== '(') return null;
  const close = open === '(' ? ')' : open;
  let j = i + 1, title = '';
  while (j < text.length) {
    const c = text[j];
    if (c === '\\' && j + 1 < text.length) { title += c + text[j + 1]; j += 2; continue; }
    if (c === close) return { title: title, pos: j + 1 };
    if (open === '(' && c === '(') return null;
    title += c; j++;
  }
  return null;
}
// Link-label matching normalizes only whitespace and case (Unicode case fold);
// it does NOT resolve backslash escapes or entities, so `[foo\!]` and `[foo!]`
// are different labels.
function normLabel(s) { return s.replace(/[ \t\r\n]+/g, ' ').trim().toLowerCase().toUpperCase().toLowerCase(); }

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

/* ===========================================================================
   PHASE 2 - render block tree -> HTML (inline parsing happens on leaf text)
   =========================================================================== */
function renderTree(doc, refs) {
  return renderChildren(doc, refs, false);
}
function renderChildren(block, refs, tight) {
  let out = '';
  for (const child of block.children) {
    if (child.type === 'empty') continue;
    out += renderBlock(child, refs, tight);
  }
  return out;
}
function renderBlock(b, refs, tight) {
  switch (b.type) {
    case 'paragraph': {
      let html = parseInlines(b.lines.join('\n').replace(/^\s+|\s+$/g, ''), refs);
      if (b.taskPrefix) html = b.taskPrefix + ' ' + html;
      return tight ? html : '<p>' + html + '</p>\n';
    }
    case 'heading': {
      const html = parseInlines(b.lines.join('\n').replace(/^\s+|\s+$/g, ''), refs);
      return '<h' + b.level + '>' + html + '</h' + b.level + '>\n';
    }
    case 'thematic': return '<hr />\n';
    case 'blockquote': return '<blockquote>\n' + renderChildren(b, refs, false) + '</blockquote>\n';
    case 'list': {
      const tag = b.listType === 'ordered' ? 'ol' : 'ul';
      const startAttr = (b.listType === 'ordered' && b.start !== 1 && b.start !== null) ? ' start="' + b.start + '"' : '';
      return '<' + tag + startAttr + '>\n' + renderChildren(b, refs, b.tight) + '</' + tag + '>\n';
    }
    case 'item': {
      // GFM task list item: first block is a paragraph starting with [ ], [x] or [X].
      const first = b.children.find(c => c.type !== 'empty');
      if (first && first.type === 'paragraph' && first.lines.length && !first.taskPrefix) {
        const tm = /^\[([ xX])\](?=\s|$)/.exec(first.lines[0]);
        if (tm) {
          const checked = tm[1] === 'x' || tm[1] === 'X';
          first.taskPrefix = '<input ' + (checked ? 'checked="" ' : '') + 'disabled="" type="checkbox" />';
          first.lines = first.lines.slice();
          first.lines[0] = first.lines[0].slice(tm[0].length);
        }
      }
      let inner = renderChildren(b, refs, tight);
      if (tight) return '<li>' + inner.replace(/^\n/, '').replace(/\n$/, '') + '</li>\n';
      return '<li>' + (inner === '' ? '' : '\n' + inner) + '</li>\n';
    }
    case 'codeblock': {
      let code = b.lines.join('\n');
      if (b.kind === 'fenced') code = code + (b.lines.length ? '\n' : '');
      else {
        code = code.replace(/\n+$/, '\n');
        code = code.replace(/^\n+/, '');
        if (!/\n$/.test(code)) code += '\n';
      }
      if (b.kind === 'fenced' && b.lines.length === 0) code = '';
      const info = b.kind === 'fenced' && b.info ? b.info.split(/\s+/)[0] : '';
      const cls = info ? ' class="language-' + esc(decodeInlineText(info).toLowerCase()) + '"' : '';
      return '<pre><code' + cls + '>' + esc(code) + '</code></pre>\n';
    }
    case 'htmlblock': return b.lines.join('\n') + '\n';
    case 'table': return renderTable(b, refs);
    default: return '';
  }
}

/* ===========================================================================
   Inline parsing - array of pieces + array delimiter list -> HTML string
   =========================================================================== */
const RE_TEXT = /^[^\n\\`&<>\[\]!*_~]+/;
const RE_ENTITY = ENTITY_RE;
const TAGNAME2 = '[A-Za-z][A-Za-z0-9-]*';
const ATTR2 = '(?:\\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\\s*=\\s*(?:[^\\s"\'=<>`]+|\'[^\']*\'|"[^"]*"))?)';
const RE_HTMLTAG = new RegExp('^(?:' +
  '<' + TAGNAME2 + ATTR2 + '*\\s*/?>' + '|' +
  '</' + TAGNAME2 + '\\s*>' + '|' +
  '<!-->|<!--->|<!--(?:[^-]|-[^-]|--[^>])*-->|' +
  '<\\?[\\s\\S]*?\\?>|' +
  '<![A-Za-z][^>]*>|' +
  '<!\\[CDATA\\[[\\s\\S]*?\\]\\]>' +
  ')');
const RE_AUTOLINK = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\x00-\x20]*)>/;
const RE_EMAIL = /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;
const RE_WWW = /^www\.[^\s<]*/;
const RE_URLAUTO = /^https?:\/\/[^\s<]*/;

/* ---- GFM extended autolinks (bare www / http(s) URLs and emails in text) ---- */
// Pattern for a URL or email candidate inside a plain-text run.
const RE_BAREURL = /(?:https?:\/\/|www\.)[^\s<]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/g;
// Peel GFM trailing punctuation off a matched URL/email; `trail` is the removed
// tail (kept as plain text after the link).
function trimUrlPunct(url) {
  let trail = '', changed = true, guard = 0;
  while (changed && url.length && ++guard < 200) {
    changed = false;
    const lastCh = url[url.length - 1];
    if ('?!.,:*_~'.indexOf(lastCh) !== -1) { trail = lastCh + trail; url = url.slice(0, -1); changed = true; continue; }
    if (lastCh === ')') {
      const opens = (url.match(/\(/g) || []).length;
      const closes = (url.match(/\)/g) || []).length;
      if (closes > opens) { trail = lastCh + trail; url = url.slice(0, -1); changed = true; continue; }
    }
    if (lastCh === ';') {
      const em = /&[A-Za-z0-9]+;$/.exec(url);
      if (em) { trail = em[0] + trail; url = url.slice(0, url.length - em[0].length); changed = true; continue; }
    }
  }
  return { url: url, trail: trail };
}
// The host of a bare URL must contain a dot and not end with one.
function validAutolinkUrl(url) {
  const host = url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
  return host.indexOf('.') !== -1 && !/\.$/.test(host);
}
function buildAutolink(raw, isEmail) {
  const t = trimUrlPunct(raw);
  if (!t.url) return null;
  if (isEmail) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t.url)) return null;
    return { html: '<a href="mailto:' + esc(t.url) + '">' + esc(t.url) + '</a>', trail: t.trail };
  }
  if (!validAutolinkUrl(t.url)) return null;
  const isWww = /^www\./i.test(t.url);
  const href = isWww ? 'http://' + t.url : t.url;
  return { html: '<a href="' + esc(normalizeUri(href)) + '">' + esc(t.url) + '</a>', trail: t.trail };
}
// Emit a plain-text run, splitting out any GFM autolinks it contains. A link is
// only recognised at a boundary: start of run, whitespace, or one of * _ ~ (.
function emitTextRun(pieces, run, prevChar) {
  RE_BAREURL.lastIndex = 0;
  let last = 0, m, guard = 0;
  while ((m = RE_BAREURL.exec(run)) !== null) {
    if (++guard > 5000) break;
    const start = m.index;
    const before = start === 0 ? prevChar : run[start - 1];
    const boundaryOK = before === '' || before === undefined || /[\s*_~(]/.test(before);
    const isEmail = /^https?:\/\/|^www\./i.test(m[0]) ? false : m[0].indexOf('@') !== -1;
    const link = boundaryOK ? buildAutolink(m[0], isEmail) : null;
    if (!link) continue; // leave as plain text; scanning resumes past this match
    if (start > last) pieces.push({ kind: 'text', text: esc(run.slice(last, start)) });
    pieces.push({ kind: 'raw', html: link.html });
    last = start + (m[0].length - link.trail.length); // trailing punctuation stays plain
    RE_BAREURL.lastIndex = last;
  }
  if (last < run.length) pieces.push({ kind: 'text', text: esc(run.slice(last)) });
}

function parseInlines(src, refs) {
  const s = src;
  const pieces = [];         // { kind, ... }
  const delims = [];         // indices into `pieces` that are delimiter runs / brackets
  let i = 0;
  const n = s.length;

  function pushText(t) { pieces.push({ kind: 'text', text: t }); }

  while (i < n) {
    const c = s[i];
    if (c === '\n') {
      // line break: 2+ spaces before -> hard break
      let j = pieces.length - 1;
      const prev = pieces[j];
      if (prev && prev.kind === 'text' && /  $/.test(prev.text)) { prev.text = prev.text.replace(/ +$/, ''); pieces.push({ kind: 'hardbreak' }); }
      else if (prev && prev.kind === 'text' && /\\$/.test(prev.text)) { prev.text = prev.text.slice(0, -1); pieces.push({ kind: 'hardbreak' }); }
      else { if (prev && prev.kind === 'text') prev.text = prev.text.replace(/ +$/, ''); pieces.push({ kind: 'softbreak' }); }
      i++;
      // skip leading spaces of next line
      while (i < n && (s[i] === ' ' || s[i] === '\t')) i++;
      continue;
    }
    const m = RE_TEXT.exec(s.slice(i));
    if (m) { emitTextRun(pieces, m[0], i === 0 ? '' : s[i - 1]); i += m[0].length; continue; }

    if (c === '\\') {
      if (i + 1 < n && ESCAPABLE.indexOf(s[i + 1]) !== -1) { pieces.push({ kind: 'text', text: esc(s[i + 1]) }); i += 2; continue; }
      if (i + 1 < n && s[i + 1] === '\n') { pieces.push({ kind: 'hardbreak' }); i += 2; while (i < n && (s[i] === ' ' || s[i] === '\t')) i++; continue; }
      pushText('\\'); i++; continue;
    }
    if (c === '`') {
      let ticks = 0; while (s[i + ticks] === '`') ticks++;
      const open = '`'.repeat(ticks);
      const closeIdx = findClose(s, i + ticks, open);
      if (closeIdx === -1) { pushText(open); i += ticks; continue; }
      let code = s.slice(i + ticks, closeIdx).replace(/\n/g, ' ');
      if (code.length > 2 && code[0] === ' ' && code[code.length - 1] === ' ' && /[^ ]/.test(code)) code = code.slice(1, -1);
      pieces.push({ kind: 'raw', html: '<code>' + esc(code) + '</code>' });
      i = closeIdx + ticks; continue;
    }
    if (c === '&') {
      const em = RE_ENTITY.exec(s.slice(i));
      if (em) { const d = decodeEntity(em[0]); if (d !== null) { pieces.push({ kind: 'text', text: esc(d) }); i += em[0].length; continue; } }
      pushText('&amp;'); i++; continue;
    }
    if (c === '<') {
      let mm = RE_AUTOLINK.exec(s.slice(i));
      if (mm) { const url = mm[1]; pieces.push({ kind: 'raw', html: '<a href="' + esc(normalizeUri(url)) + '">' + esc(url) + '</a>' }); i += mm[0].length; continue; }
      mm = RE_EMAIL.exec(s.slice(i));
      if (mm) { const addr = mm[1]; pieces.push({ kind: 'raw', html: '<a href="mailto:' + esc(addr) + '">' + esc(addr) + '</a>' }); i += mm[0].length; continue; }
      mm = RE_HTMLTAG.exec(s.slice(i));
      if (mm) { pieces.push({ kind: 'raw', html: mm[0] }); i += mm[0].length; continue; }
      pushText('&lt;'); i++; continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      const run = scanRun(s, i, c);
      const piece = { kind: 'text', text: c.repeat(run.len), delim: c, canOpen: run.canOpen, canClose: run.canClose, numDelims: run.len, origLen: run.len };
      pieces.push(piece);
      delims.push(pieces.length - 1);
      i += run.len; continue;
    }
    if (c === '[') {
      const piece = { kind: 'text', text: '[', bracket: '[', pos: pieces.length, srcPos: i };
      pieces.push(piece); delims.push(pieces.length - 1);
      i++; continue;
    }
    if (c === '!' && s[i + 1] === '[') {
      const piece = { kind: 'text', text: '![', bracket: '![', pos: pieces.length, srcPos: i };
      pieces.push(piece); delims.push(pieces.length - 1);
      i += 2; continue;
    }
    if (c === ']') {
      i = handleCloseBracket(s, i, pieces, delims, refs);
      continue;
    }
    pushText(esc(c)); i++;
  }

  resolveEmphasis(pieces, delims, -1);
  return serialize(pieces);
}

function scanRun(s, i, ch) {
  let len = 0; while (s[i + len] === ch) len++;
  const before = i === 0 ? ' ' : s[i - 1];
  const after = i + len < s.length ? s[i + len] : ' ';
  const beforeWs = /\s/.test(before) || before === undefined;
  const afterWs = /\s/.test(after) || after === undefined;
  const beforePunct = isPunct(before);
  const afterPunct = isPunct(after);
  const leftFlank = !afterWs && (!afterPunct || beforeWs || beforePunct);
  const rightFlank = !beforeWs && (!beforePunct || afterWs || afterPunct);
  let canOpen, canClose;
  if (ch === '_') { canOpen = leftFlank && (!rightFlank || beforePunct); canClose = rightFlank && (!leftFlank || afterPunct); }
  else { canOpen = leftFlank; canClose = rightFlank; }
  return { len: len, canOpen: canOpen, canClose: canClose };
}
// CommonMark 0.31.2 treats any Unicode Punctuation (P*) OR Symbol (S*) codepoint
// as "punctuation" for the emphasis flanking rules, so currency/maths symbols
// (e.g. $, £, €, +, =, ~) count just like ASCII punctuation.
const RE_PUNCT = /[\p{P}\p{S}]/u;
function isPunct(c) { return c !== undefined && RE_PUNCT.test(c); }

function resolveEmphasis(pieces, delims, bottom) {
  const floor = {};
  const isD = idx => { const p = pieces[idx]; return p && p.delim && !p.used; };
  let ci = 0;
  // iterate closers
  const stack = delims.filter(idx => pieces[idx] && pieces[idx].delim);
  let closerPos = 0, guard = 0;
  while (closerPos < stack.length) {
    if (++guard > stack.length * stack.length + 200) break;
    const cIdx = stack[closerPos];
    const closer = pieces[cIdx];
    if (!closer || !closer.delim || closer.used || !closer.canClose || closer.numDelims === 0) { closerPos++; continue; }
    const ch = closer.delim;
    let found = false, openerPos = -1;
    for (let k = closerPos - 1; k >= 0; k--) {
      const oIdx = stack[k];
      const opener = pieces[oIdx];
      if (!opener || !opener.delim || opener.used || opener.delim !== ch || !opener.canOpen || opener.numDelims === 0) continue;
      const triadBlocked = (closer.canOpen || opener.canClose) && (closer.origLen % 3 !== 0) && ((opener.origLen + closer.origLen) % 3 === 0);
      if (!triadBlocked) { found = true; openerPos = k; break; }
    }
    if (!found) { closerPos++; continue; }
    const opener = pieces[stack[openerPos]];
    if (ch === '~') {
      if (closer.numDelims < 2 || opener.numDelims < 2) { closerPos++; continue; }
    }
    const use = ch === '~' ? 2 : (closer.numDelims >= 2 && opener.numDelims >= 2 ? 2 : 1);
    const tag = ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
    opener.text = opener.text.slice(0, opener.text.length - use);
    closer.text = closer.text.slice(0, closer.text.length - use);
    opener.numDelims -= use; closer.numDelims -= use;
    // wrap pieces between opener and closer
    const oIdx = stack[openerPos], cIdx2 = cIdx;
    pieces[oIdx].after = pieces[oIdx].after || '';
    // mark open/close by inserting raw open/close around the range
    pieces[oIdx].openTags = (pieces[oIdx].openTags || '');
    // Simplest: record wrap boundaries via side arrays
    wrapRange(pieces, oIdx, cIdx2, tag);
    // remove delimiters strictly between (mark used)
    for (let k = openerPos + 1; k < closerPos; k++) { const mid = pieces[stack[k]]; if (mid && mid.delim) mid.used = true; }
    if (opener.numDelims === 0) opener.used = true;
    if (closer.numDelims === 0) { closer.used = true; closerPos++; }
  }
}
function wrapRange(pieces, oIdx, cIdx, tag) {
  // A later-resolved wrap on the SAME piece is the OUTER one, so its open tag
  // goes first (unshift) and its close tag last (push): ***x*** -> <em><strong>x</strong></em>.
  pieces[oIdx].wrapOpen = (pieces[oIdx].wrapOpen || []);
  pieces[oIdx].wrapOpen.unshift(tag);
  pieces[cIdx].wrapClose = (pieces[cIdx].wrapClose || []);
  pieces[cIdx].wrapClose.push(tag);
}

function handleCloseBracket(s, i, pieces, delims, refs) {
  // find last unmatched bracket delim
  let openerDelimPos = -1;
  for (let k = delims.length - 1; k >= 0; k--) {
    const p = pieces[delims[k]];
    if (p && p.bracket && !p.used) { openerDelimPos = k; break; }
  }
  if (openerDelimPos === -1) { pieces.push({ kind: 'text', text: ']' }); return i + 1; }
  const openerPieceIdx = delims[openerDelimPos];
  const opener = pieces[openerPieceIdx];
  // A deactivated bracket (an earlier `[` disabled because a link already formed
  // inside it - no links inside links) still pairs with this `]`, but only to
  // consume it as a literal `]`; it can never form a new link.
  if (opener.inactive) { opener.used = true; pieces.push({ kind: 'text', text: ']' }); return i + 1; }
  const isImage = opener.bracket === '![';
  let j = i + 1;
  let dest = null, title = null, matched = false;

  if (s[j] === '(') {
    let k = j + 1;
    while (k < s.length && /[ \t\n]/.test(s[k])) k++;
    const dr = s[k] === ')' ? { dest: '', pos: k } : scanDest(s, k);
    if (dr) {
      k = dr.pos; let sawSpace = false;
      while (k < s.length && /[ \t\n]/.test(s[k])) { k++; sawSpace = true; }
      const tr = sawSpace ? scanTitle(s, k) : null;
      if (tr) { title = tr.title; k = tr.pos; while (k < s.length && /[ \t\n]/.test(s[k])) k++; }
      if (s[k] === ')') { dest = dr.dest || ''; matched = true; j = k + 1; }
    }
  }
  if (!matched) {
    // reference link: [label][ref], [label][], [label]. The label used for
    // lookup is the RAW bracket source (backslash escapes preserved, not the
    // escape-processed inline text) so labels match the same way definitions do.
    const rawLabel = s.slice(opener.srcPos + (isImage ? 2 : 1), i);
    let refLabel = null, endPos = i + 1;
    if (s[i + 1] === '[') {
      const lr = scanBracketLabel(s, i + 1);
      if (lr) { refLabel = lr.label.trim() === '' ? rawLabel : lr.label; endPos = lr.pos; }
      else refLabel = null;
    } else { refLabel = rawLabel; endPos = i + 1; }
    if (refLabel !== null) {
      const def = refs[normLabel(refLabel)];
      if (def) { dest = def.url; title = def.title; matched = true; j = endPos; }
    }
  }

  if (!matched) { opener.used = true; pieces.push({ kind: 'text', text: ']' }); return i + 1; }

  // build link/image: resolve emphasis inside, then wrap
  resolveEmphasisRange(pieces, delims, openerPieceIdx);
  // Any delimiter still live inside the link text is now sealed: link brackets
  // bind more tightly than emphasis, so an inner `*`/`_` must not pair with one
  // outside the brackets (e.g. `*[bar*](/url)` keeps both `*` literal).
  for (let k = openerPieceIdx + 1; k < pieces.length; k++) {
    const pk = pieces[k];
    if (pk && pk.delim && !pk.used) pk.used = true;
  }
  const innerStart = openerPieceIdx;
  opener.kind = 'text'; opener.text = '';
  const url = normalizeUri(decodeInlineText(dest));
  const titleAttr = title !== null ? ' title="' + esc(decodeInlineText(title)) + '"' : '';
  if (isImage) {
    const alt = piecesPlainText(pieces, openerPieceIdx + 1);
    opener.wrapOpen = null;
    // collapse the range into a single image raw piece
    const rawImg = '<img src="' + esc(url) + '" alt="' + esc(alt) + '"' + titleAttr + ' />';
    collapseRange(pieces, openerPieceIdx, rawImg);
  } else {
    opener.wrapBefore = '<a href="' + esc(url) + '"' + titleAttr + '>';
    pieces.push({ kind: 'text', text: '', wrapAfterClose: '</a>' });
    // deactivate earlier `[` brackets (no links inside links) - they stay on the
    // stack, so a later `]` still pairs with them (as a literal), but they can no
    // longer open a link.
    for (let k = openerDelimPos - 1; k >= 0; k--) { const p = pieces[delims[k]]; if (p && p.bracket === '[') p.inactive = true; }
  }
  opener.used = true;
  return j;
}
function scanBracketLabel(s, i) {
  if (s[i] !== '[') return null;
  let j = i + 1, label = '';
  while (j < s.length) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length) { label += c + s[j + 1]; j += 2; continue; }
    if (c === ']') return { label: label, pos: j + 1 };
    if (c === '[') return null;
    label += c; j++;
  }
  return null;
}
function resolveEmphasisRange(pieces, delims, fromIdx) {
  // resolve emphasis only within pieces after fromIdx (approximate)
  const sub = delims.filter(idx => idx > fromIdx && pieces[idx] && pieces[idx].delim);
  resolveEmphasis(pieces, sub, fromIdx);
}
function collapseRange(pieces, startIdx, rawHtml) {
  for (let k = startIdx + 1; k < pieces.length; k++) pieces[k] = { kind: 'text', text: '' };
  pieces[startIdx] = { kind: 'raw', html: rawHtml };
}
function piecesText(pieces, from) {
  let t = '';
  for (let k = from; k < pieces.length; k++) { const p = pieces[k]; if (p.kind === 'text') t += p.text; }
  return t;
}
function piecesPlainText(pieces, from) {
  let t = '';
  for (let k = from; k < pieces.length; k++) {
    const p = pieces[k];
    if (p.kind === 'text') t += p.text;
    else if (p.kind === 'raw') {
      // A nested image contributes its alt text to the outer alt string; other
      // tags contribute only their text content.
      t += p.html.replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/g, '$1').replace(/<[^>]*>/g, '');
    }
  }
  return t;
}

function serialize(pieces) {
  let out = '';
  for (const p of pieces) {
    if (p.delim) {
      // A delimiter run renders as: the closings it produced (they wrap to its
      // LEFT) + any leftover literal delimiter characters (the middle) + the
      // openings it produced (they wrap to its RIGHT). This keeps unpaired
      // delimiters on the correct side of the emphasis, e.g. `**foo*` ->
      // `*<em>foo</em>` and `*foo**` -> `<em>foo</em>*`.
      if (p.wrapClose) for (const t of p.wrapClose) out += '</' + t + '>';
      out += p.text || '';
      if (p.wrapOpen) for (const t of p.wrapOpen) out += '<' + t + '>';
      continue;
    }
    if (p.used && p.kind === 'text' && !p.wrapOpen && !p.wrapClose && !p.wrapBefore) { out += p.text || ''; continue; }
    if (p.wrapBefore) out += p.wrapBefore;
    if (p.wrapOpen) for (const t of p.wrapOpen) out += '<' + t + '>';
    if (p.kind === 'raw') out += p.html;
    else out += (p.text || '');
    if (p.kind === 'hardbreak') out += '<br />\n';
    if (p.kind === 'softbreak') out += '\n';
    if (p.wrapClose) for (const t of p.wrapClose) out += '</' + t + '>';
    if (p.wrapAfterClose) out += p.wrapAfterClose;
  }
  return out;
}
function findClose(s, from, open) {
  let i = from;
  while (i < s.length) {
    if (s[i] === '`') {
      let t = 0; while (s[i + t] === '`') t++;
      if (t === open.length) return i;
      i += t;
    } else i++;
  }
  return -1;
}
function normalizeUri(uri) {
  try { return encodeURI(decodeURIComponent(uri)).replace(/%25/g, '%'); }
  catch (e) { try { return encodeURI(uri); } catch (e2) { return uri; } }
}

/* ===========================================================================
   GFM tables (recognised in a post-pass over paragraph blocks)
   =========================================================================== */
// Split one table row into trimmed cell strings. An escaped pipe (\|) is a
// literal pipe; a single unescaped leading/trailing pipe is a fence, not a cell.
function splitTableRow(line) {
  const s = line.trim();
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += c + s[i + 1]; i++; continue; }
    if (c === '|') { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  if (cells.length > 1 && cells[0].trim() === '') cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map(c => c.trim());
}
// Validate a delimiter row; return an array of per-column alignments or null.
function parseDelimiterRow(line) {
  if (line.indexOf('|') === -1) return null; // require at least one pipe
  const cells = splitTableRow(line);
  if (!cells.length) return null;
  const aligns = [];
  for (const cell of cells) {
    const m = /^(:?)-+(:?)$/.exec(cell);
    if (!m) return null;
    const l = m[1] === ':', r = m[2] === ':';
    aligns.push(l && r ? 'center' : r ? 'right' : l ? 'left' : null);
  }
  return aligns;
}
// If `lines` (a paragraph's accumulated lines) contain a header row immediately
// followed by a delimiter row with matching column count, describe the table.
function tryBuildTable(lines) {
  for (let d = 1; d < lines.length; d++) {
    const aligns = parseDelimiterRow(lines[d]);
    if (!aligns) continue;
    const header = splitTableRow(lines[d - 1]);
    if (header.length !== aligns.length) continue;
    return { headerIndex: d - 1, delimIndex: d, aligns };
  }
  return null;
}
// Walk the block tree, converting qualifying paragraphs into table blocks.
function extractTables(block) {
  const kids = block.children;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];
    if (child.type === 'paragraph') {
      const built = tryBuildTable(child.lines);
      if (!built) continue;
      const repl = [];
      if (built.headerIndex > 0) {
        const para = makeBlock('paragraph', { open: false });
        para.lines = child.lines.slice(0, built.headerIndex);
        repl.push(para);
      }
      const headerCells = splitTableRow(child.lines[built.headerIndex]);
      const bodyRows = [];
      for (let r = built.delimIndex + 1; r < child.lines.length; r++) {
        bodyRows.push(splitTableRow(child.lines[r]));
      }
      const tbl = makeBlock('table', { open: false, aligns: built.aligns, headerCells, bodyRows });
      repl.push(tbl);
      kids.splice(i, 1, ...repl);
      i += repl.length - 1;
    } else if (child.children && child.children.length) {
      extractTables(child);
    }
  }
}
function renderTable(b, refs) {
  const cols = b.aligns.length;
  const attr = a => a ? ' align="' + a + '"' : '';
  const cell = (tag, text, a) => '<' + tag + attr(a) + '>' + parseInlines(text || '', refs) + '</' + tag + '>\n';
  let out = '<table>\n<thead>\n<tr>\n';
  for (let i = 0; i < cols; i++) out += cell('th', b.headerCells[i], b.aligns[i]);
  out += '</tr>\n</thead>\n';
  if (b.bodyRows.length) {
    out += '<tbody>\n';
    for (const row of b.bodyRows) {
      out += '<tr>\n';
      for (let i = 0; i < cols; i++) out += cell('td', row[i], b.aligns[i]);
      out += '</tr>\n';
    }
    out += '</tbody>\n';
  }
  out += '</table>\n';
  return out;
}

/* ===========================================================================
   Public entry
   =========================================================================== */
export function renderMarkdown(src) {
  const { doc, refs } = parseDocument(String(src));
  let html = renderTree(doc, refs);
  return html;
}

// Render INLINE markdown only (code spans, emphasis, links) — no block
// constructs. Used for table-cell content such as requirement descriptions and
// test-case action / expected-response steps, which are inline contexts.
export function renderInline(src) {
  return parseInlines(String(src == null ? '' : src), Object.create(null));
}
