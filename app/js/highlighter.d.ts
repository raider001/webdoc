import type { HighlightToken } from './highlight/lexer.js';
/** One per-language tokenizer function, as exported by ./highlight/grammars.js. */
export type HighlightTokenizer = (src: string) => HighlightToken[];
/**
 * Public entry point. Highlights every <pre> > <code> under `root`.
 * Unknown languages fall back to a generic pass; code with no language hint
 * is left untouched. Never throws.
 */
export declare function highlightWithin(root: Element | Document): void;
