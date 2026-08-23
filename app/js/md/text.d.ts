/**
 * Escape &, <, >, " for safe HTML text/attribute output.
 */
export declare function esc(s: string): string;
/**
 * Expand tabs to the next 4-column stop (for the whole line; content-preserving
 * where tabs are inside code is handled by the block logic separately).
 */
export declare function expandTabs(line: string): string;
/**
 * Percent-encode a URI for output while preserving any escapes it already has.
 */
export declare function normalizeUri(uri: string): string;
export declare const ENTITY_RE: RegExp;
/**
 * Decode one matched HTML entity reference (named or numeric).
 * @param m the full matched entity text, e.g. "&amp;" or "&#39;"
 * @returns the decoded character(s), or null if the named entity is not recognized
 */
export declare function decodeEntity(m: string): string | null;
export declare const ESCAPABLE = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
/**
 * Decode HTML entities and backslash escapes in a raw text run (used for text runs).
 */
export declare function decodeInlineText(s: string): string;
