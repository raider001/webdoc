// highlight/lexer.ts - the shared lexing core for the syntax highlighter:
// tiny scanning helpers, a couple of shared token regexes, and the `Lexer`
// state object every per-language grammar drives. Extracted from highlighter.js.
// ---------------------------------------------------------------------------

// ---- tiny scanning helpers ------------------------------------------------

/**
 * Length of the rest of the current line, starting at i (newline excluded).
 */
export function lineLen(src: string, i: number): number {
  let j = i;
  while (j < src.length && src[j] !== '\n') j++;
  return j - i;
}

/**
 * Length of a C-style block comment starting at i (opened with a slash-star);
 * scans to its closing marker or to end-of-input.
 */
export function blockLen(src: string, i: number): number {
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
 */
export function quoteLen(src: string, i: number, quote: string, esc: boolean): number {
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
 */
export function atLineStart(src: string, i: number): boolean {
  let k = i - 1;
  while (k >= 0 && (src[k] === ' ' || src[k] === '\t')) k--;
  return k < 0 || src[k] === '\n';
}

/**
 * True when i sits on a token boundary (start, or after white space).
 */
export function prevIsBoundary(src: string, i: number): boolean {
  if (i === 0) return true;
  const p = src[i - 1];
  return p === ' ' || p === '\t' || p === '\n' || p === '\r';
}

/**
 * Does the next non-space character after i open a call parenthesis?
 */
export function nextIsParen(src: string, i: number): boolean {
  let j = i;
  while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++;
  return src[j] === '(';
}

/**
 * Index of the first character of i's line.
 */
export function lineStartIdx(src: string, i: number): number {
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
 */
export interface HighlightToken {
  type: string | null;
  text: string;
}

/**
 * The shared scanning-position + token-accumulator every per-language
 * tokenizer in ./grammars.js drives to build a HighlightToken[]. `prev` is
 * the last non-blank token emitted so far, used by grammars for
 * context-sensitive rules (e.g. "is this identifier right after `def`?").
 */
export class Lexer {
  src: string;
  pos: number;
  toks: HighlightToken[];
  prev: HighlightToken | null;

  constructor(src: string) {
    this.src = src;
    this.pos = 0;
    this.toks = [];
    this.prev = null; // last non-blank token {type, text}, for context rules
  }

  eof(): boolean { return this.pos >= this.src.length; }
  /**
   * @param o offset from the current position (default 0)
   */
  peek(o?: number): string | undefined { return this.src[this.pos + (o || 0)]; }
  /**
   * Try a sticky regex anchored exactly at the current position.
   * @param re a sticky (`y`-flagged) regex
   */
  match(re: RegExp): RegExpExecArray | null {
    re.lastIndex = this.pos;
    const m = re.exec(this.src);
    return (m && m.index === this.pos && m[0].length) ? m : null;
  }
  /**
   * Emit `len` chars as one token of `type` (null => plain text). len is
   * clamped to >= 1 so the driver loop can never stall.
   */
  push(type: string | null, len: number): void {
    if (!(len >= 1)) len = 1;
    const text = this.src.slice(this.pos, this.pos + len);
    this.toks.push({ type: type || null, text });
    this.pos += len;
    if (/\S/.test(text)) this.prev = { type: type || null, text };
  }
}

/**
 * Collapse neighbouring same-class tokens so the DOM stays lean.
 */
export function merge(toks: HighlightToken[]): HighlightToken[] {
  const out: HighlightToken[] = [];
  for (const t of toks) {
    const last = out[out.length - 1];
    if (last && last.type === t.type) last.text += t.text;
    else out.push({ type: t.type, text: t.text });
  }
  return out;
}
