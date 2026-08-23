import type { RefDefinition } from './blockpost.js';
/**
 * One item in the inline-parsing array of "pieces" that parseInlines() builds
 * and progressively mutates: rendering fields (kind/text/html) are set when a
 * piece is first pushed, then emphasis/link/image resolution (resolveEmphasis,
 * handleCloseBracket) attaches delimiter-run fields, bracket fields, or wrap
 * fields to record what the final serialize() pass should emit around it.
 *
 * Deliberately ONE interface rather than a union on `kind`: a piece is a
 * mutable accumulator whose `kind` is rewritten in place (handleCloseBracket
 * turns a bracket opener into plain text), and the delimiter/bracket/wrap
 * fields are orthogonal to `kind` rather than selected by it.
 */
export interface InlinePiece {
    kind: 'text' | 'raw' | 'hardbreak' | 'softbreak';
    /** literal text (kind 'text'); also holds a delimiter run's characters, or a bracket's '[' / '![' */
    text?: string;
    /** pre-built HTML (kind 'raw') */
    html?: string;
    /** the delimiter character ('*', '_', '~') if this piece is a delimiter run */
    delim?: string;
    /** whether this delimiter run can open emphasis (delimiter runs only) */
    canOpen?: boolean;
    /** whether this delimiter run can close emphasis (delimiter runs only) */
    canClose?: boolean;
    /** remaining unconsumed delimiter count (delimiter runs only; shrinks as pairs resolve) */
    numDelims?: number;
    /** the run's original length, used by the "rule of 3" multiples-of-3 check */
    origLen?: number;
    /** '[' or '![' if this piece is a bracket opener */
    bracket?: string;
    /** this piece's index in `pieces`, recorded at push time (bracket openers only) */
    pos?: number;
    /** the source index of the bracket character (bracket openers only) */
    srcPos?: number;
    /** true once this delimiter/bracket has been consumed and should render as a plain literal */
    used?: boolean;
    /** true for a bracket disabled by the "no links inside links" rule */
    inactive?: boolean;
    /** opening tags to emit immediately to this piece's right (emphasis resolution) */
    wrapOpen?: string[];
    /** closing tags to emit immediately to this piece's left (emphasis resolution) */
    wrapClose?: string[];
    /** raw HTML to emit immediately before this piece (link open tag) */
    wrapBefore?: string;
    /** raw HTML to emit immediately after this piece (link close tag) */
    wrapAfterClose?: string;
}
/**
 * Parse a leaf block's raw text into inline HTML: emphasis, strikethrough,
 * links, images, code spans, autolinks, raw HTML, entities and line breaks.
 */
export declare function parseInlines(src: string, refs: Record<string, RefDefinition>): string;
