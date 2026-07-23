// md/inline.js - inline parsing. Builds an ARRAY of pieces from a leaf block's
// text, resolves emphasis/links/images over an array-indexed delimiter list,
// then serialises to an HTML string. Also handles code spans, autolinks (incl.
// GFM bare-URL/www/email), raw HTML, entities and hard/soft breaks.
// ---------------------------------------------------------------------------
import { esc, normalizeUri, ENTITY_RE, decodeEntity, ESCAPABLE, decodeInlineText } from './text.js';
import { scanDest, scanTitle, normLabel, scanBracketLabel } from './scan.js';

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

export function parseInlines(src, refs) {
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
