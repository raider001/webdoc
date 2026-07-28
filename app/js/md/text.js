// md/text.js - low-level text helpers for the Markdown engine: HTML escaping,
// tab expansion, URI normalization, and HTML-entity / backslash-escape decoding.
// No dependencies; shared by the block, inline, render and table modules.
// ---------------------------------------------------------------------------

/* ===========================================================================
   Escaping / small helpers
   =========================================================================== */
const AMP = /[&<>"]/;
/**
 * Escape &, <, >, " for safe HTML text/attribute output.
 * @param {string} s
 * @returns {string}
 */
export function esc(s) {
  if (!AMP.test(s)) return s;
  return s.replace(/[&<>"]/g, c =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;');
}
/**
 * Expand tabs to the next 4-column stop (for the whole line; content-preserving
 * where tabs are inside code is handled by the block logic separately).
 * @param {string} line
 * @returns {string}
 */
export function expandTabs(line) {
  if (line.indexOf('\t') === -1) return line;
  let out = '', col = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\t') { const n = 4 - (col % 4); out += ' '.repeat(n); col += n; }
    else { out += ch; col++; }
  }
  return out;
}

/**
 * Percent-encode a URI for output while preserving any escapes it already has.
 * @param {string} uri
 * @returns {string}
 */
export function normalizeUri(uri) {
  try { return encodeURI(decodeURIComponent(uri)).replace(/%25/g, '%'); }
  catch (e) { try { return encodeURI(uri); } catch (e2) { return uri; } }
}

/* ===========================================================================
   Entities (a representative HTML5 named set + all numeric forms)
   Invisible / whitespace characters are written as \u escapes so they survive
   editing intact (a literal U+00A0/zero-width char is indistinguishable from a
   normal space in source).
   =========================================================================== */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0', copy: '©',
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
  uacute: 'ú', shy: '\u00AD', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
  zwnj: '\u200C', zwj: '\u200D', star: '☆', quot_: '"',
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
export const ENTITY_RE = /^&(#[Xx][0-9A-Fa-f]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{0,31});/;
/**
 * Decode one matched HTML entity reference (named or numeric).
 * @param {string} m - the full matched entity text, e.g. "&amp;" or "&#39;"
 * @returns {string|null} the decoded character(s), or null if the named entity is not recognized
 */
export function decodeEntity(m) {
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
export const ESCAPABLE = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
/**
 * Decode HTML entities and backslash escapes in a raw text run (used for text runs).
 * @param {string} s
 * @returns {string}
 */
export function decodeInlineText(s) {
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
