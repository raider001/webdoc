/**
 * Length of the rest of the current line, starting at i (newline excluded).
 */
export declare function lineLen(src: string, i: number): number;
/**
 * Length of a C-style block comment starting at i (opened with a slash-star);
 * scans to its closing marker or to end-of-input.
 */
export declare function blockLen(src: string, i: number): number;
/**
 * Length of a quoted run starting at the opening quote i. `esc` toggles
 * backslash escapes; single-line quotes stop before a newline; anything
 * unterminated stops at end-of-input.
 */
export declare function quoteLen(src: string, i: number, quote: string, esc: boolean): number;
/**
 * True when only blank space precedes i on its line (a "logical line start").
 */
export declare function atLineStart(src: string, i: number): boolean;
/**
 * True when i sits on a token boundary (start, or after white space).
 */
export declare function prevIsBoundary(src: string, i: number): boolean;
/**
 * Does the next non-space character after i open a call parenthesis?
 */
export declare function nextIsParen(src: string, i: number): boolean;
/**
 * Index of the first character of i's line.
 */
export declare function lineStartIdx(src: string, i: number): number;
export declare const RE_ID: RegExp;
export declare const RE_NUM_GEN: RegExp;
export declare const RE_NUM_PY: RegExp;
export declare const RE_NUM_JAVA: RegExp;
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
export declare class Lexer {
    src: string;
    pos: number;
    toks: HighlightToken[];
    prev: HighlightToken | null;
    constructor(src: string);
    eof(): boolean;
    /**
     * @param o offset from the current position (default 0)
     */
    peek(o?: number): string | undefined;
    /**
     * Try a sticky regex anchored exactly at the current position.
     * @param re a sticky (`y`-flagged) regex
     */
    match(re: RegExp): RegExpExecArray | null;
    /**
     * Emit `len` chars as one token of `type` (null => plain text). len is
     * clamped to >= 1 so the driver loop can never stall.
     */
    push(type: string | null, len: number): void;
}
/**
 * Collapse neighbouring same-class tokens so the DOM stays lean.
 */
export declare function merge(toks: HighlightToken[]): HighlightToken[];
