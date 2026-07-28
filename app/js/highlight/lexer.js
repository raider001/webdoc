// highlight/lexer.js - the shared lexing core for the syntax highlighter:
// tiny scanning helpers, a couple of shared token regexes, and the `Lexer`
// state object every per-language grammar drives. Extracted from highlighter.js.
// ---------------------------------------------------------------------------

// ---- tiny scanning helpers ------------------------------------------------

/**
 * Length of the rest of the current line, starting at i (newline excluded).
 * @param {string} src
 * @param {number} i
 * @returns {number}
 */
export function lineLen(src, i) {
  let j = i;
  while (j < src.length && src[j] !== '\n') j++;
  return j - i;
}

/**
 * Length of a C-style block comment starting at i (opened with a slash-star);
 * scans to its closing marker or to end-of-input.
 * @param {string} src
 * @param {number} i
 * @returns {number}
 */
export function blockLen(src, i) {
  let j = i + 2;
  while (j + 1 < src.length) {
    if (src[j] === '*' && src[j + 1] === '/') return (j + 2) - i;
    j++;
  }
  return src.length - i;
}

/**
 * Length of a quoted run starting at the opening quote i. `esc` toggles
 * backslash escapes; single-line quotes stop before a newline; anything
 * unterminated stops at end-of-input.
 * @param {string} src
 * @param {number} i
 * @param {string} quote
 * @param {boolean} esc
 * @returns {number}
 */
export function quoteLen(src, i, quote, esc) {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (esc && c === '\\') { j += 2; continue; }
    if (c === quote) return (j + 1) - i;
    if (c === '\n') return j - i;
    j++;
  }
  return src.length - i;
}

/**
 * True when only blank space precedes i on its line (a "logical line start").
 * @param {string} src
 * @param {number} i
 * @returns {boolean}
 */
export function atLineStart(src, i) {
  let k = i - 1;
  while (k >= 0 && (src[k] === ' ' || src[k] === '\t')) k--;
  return k < 0 || src[k] === '\n';
}

/**
 * True when i sits on a token boundary (start, or after white space).
 * @param {string} src
 * @param {number} i
 * @returns {boolean}
 */
export function prevIsBoundary(src, i) {
  if (i === 0) return true;
  const p = src[i - 1];
  return p === ' ' || p === '\t' || p === '\n' || p === '\r';
}

/**
 * Does the next non-space character after i open a call parenthesis?
 * @param {string} src
 * @param {number} i
 * @returns {boolean}
 */
export function nextIsParen(src, i) {
  let j = i;
  while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++;
  return src[j] === '(';
}

/**
 * Index of the first character of i's line.
 * @param {string} src
 * @param {number} i
 * @returns {number}
 */
export function lineStartIdx(src, i) {
  let k = i;
  while (k > 0 && src[k - 1] !== '\n') k--;
  return k;
}

// ---- shared token patterns (sticky; my own) -------------------------------

export const RE_ID       = /[A-Za-z_]\w*/y;
export const RE_NUM_GEN  = /(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/y;
export const RE_NUM_PY   = /(?:0[xXbBoO][0-9a-fA-F_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)[jJ]?/y;
export const RE_NUM_JAVA = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)[fFdDlL]?/y;

// ---- the lexer ------------------------------------------------------------

/**
 * One classified span of source-code text emitted by Lexer#push. `type` is
 * a token-class name (e.g. 'keyword', 'string', 'comment') or null for plain,
 * unhighlighted text. Every per-language tokenizer in ./grammars.js builds
 * arrays of these; highlighter.js merges adjacent same-type runs (see merge()
 * below) and rebuilds the <code> element's children from them.
 * @typedef {Object} HighlightToken
 * @property {string|null} type
 * @property {string} text
 */

/**
 * The shared scanning-position + token-accumulator every per-language
 * tokenizer in ./grammars.js drives to build a HighlightToken[]. `prev` is
 * the last non-blank token emitted so far, used by grammars for
 * context-sensitive rules (e.g. "is this identifier right after `def`?").
 */
export class Lexer {
  /** @param {string} src */
  constructor(src) {
    /** @type {string} */
    this.src = src;
    /** @type {number} */
    this.pos = 0;
    /** @type {HighlightToken[]} */
    this.toks = [];
    /** @type {HighlightToken|null} */
    this.prev = null; // last non-blank token {type, text}, for context rules
  }
  /** @returns {boolean} */
  eof() { return this.pos >= this.src.length; }
  /**
   * @param {number} [o] - offset from the current position (default 0)
   * @returns {string|undefined}
   */
  peek(o) { return this.src[this.pos + (o || 0)]; }
  /**
   * Try a sticky regex anchored exactly at the current position.
   * @param {RegExp} re - a sticky (`y`-flagged) regex
   * @returns {RegExpExecArray|null}
   */
  match(re) {
    re.lastIndex = this.pos;
    const m = re.exec(this.src);
    return (m && m.index === this.pos && m[0].length) ? m : null;
  }
  /**
   * Emit `len` chars as one token of `type` (null => plain text). len is
   * clamped to >= 1 so the driver loop can never stall.
   * @param {string|null} type
   * @param {number} len
   * @returns {void}
   */
  push(type, len) {
    if (!(len >= 1)) len = 1;
    const text = this.src.slice(this.pos, this.pos + len);
    this.toks.push({ type: type || null, text });
    this.pos += len;
    if (/\S/.test(text)) this.prev = { type: type || null, text };
  }
}

/**
 * Collapse neighbouring same-class tokens so the DOM stays lean.
 * @param {HighlightToken[]} toks
 * @returns {HighlightToken[]}
 */
export function merge(toks) {
  const out = [];
  for (const t of toks) {
    const last = out[out.length - 1];
    if (last && last.type === t.type) last.text += t.text;
    else out.push({ type: t.type, text: t.text });
  }
  return out;
}
