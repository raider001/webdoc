export declare const INTERIM = false;
/**
 * Parse and render a full Markdown document to an HTML string.
 */
export declare function renderMarkdown(src: string): string;
/**
 * Render INLINE markdown only (code spans, emphasis, links) — no block
 * constructs. Used for table-cell content such as requirement descriptions and
 * test-case action / expected-response steps, which are inline contexts.
 */
export declare function renderInline(src?: string): string;
