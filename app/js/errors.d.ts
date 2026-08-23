/**
 * The most useful human-readable string available for a caught value.
 *
 * An Error yields its message; anything else is stringified, which is what makes
 * this total. Never throws, and never returns undefined, so it is safe in a
 * catch block and in a template literal.
 */
export declare function errorMessage(e: unknown): string;
