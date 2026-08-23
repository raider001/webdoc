/**
 * INLINE markdown (code / emphasis / links, no block constructs) -> sanitized
 * fragment. For single-line contexts like a requirement description.
 */
export declare function inlineMarkdown(text: unknown): DocumentFragment;
/**
 * FULL markdown (paragraphs, lists, code blocks, ...) -> sanitized fragment. Test
 * steps are structured data now, so their action / expected may be any markdown.
 */
export declare function blockMarkdown(text: unknown): DocumentFragment;
/**
 * Replace each reqgroup placeholder with the component that draws it
 * (post-sanitize).
 *
 * Two-pass on purpose. The DOM swap happens for every placeholder FIRST, while
 * this function is still synchronous, so the article's shape is final before
 * anything else in renderDoc's pipeline (link resolution, block renderers, the
 * highlighter) looks at it - and so the asynchronous fallback has a stable host
 * to check `isConnected` on.
 */
export declare function renderRequirements(article: Element, docId: string): void;
