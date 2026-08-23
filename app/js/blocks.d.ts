/**
 * The extra context object passed to a renderer's `render(source, ctx)` call:
 * the fenced block's language and source plus the mount points (`host`, the
 * replacement container already in the DOM; `pre`, the original `<pre>` it
 * replaced) merged with whatever bag the renderBlocks() caller supplied (e.g.
 * reader.js passes `{ docId }`). Not to be confused with editor.js's unrelated
 * "Block" (WYSIWYG UI block) - this is a fenced-code-block render context.
 */
export interface BlockRenderContext {
    lang: string;
    host: HTMLElement;
    pre: HTMLElement;
    source: string;
}
/**
 * A registered renderer's render function: turns a fenced block's source text
 * into DOM. May return a Node/DocumentFragment, a Promise resolving to one
 * (for libraries that load or parse asynchronously), or nothing at all if it
 * fills `ctx.host` itself.
 */
export type RenderBlockFn = (source: string, ctx: BlockRenderContext) => Node | Promise<Node> | void;
/**
 * One registry entry: a renderer function plus its human-readable label (used
 * in the fallback notice when the renderer fails or its library is missing).
 */
export interface RendererEntry {
    render: RenderBlockFn;
    label: string;
}
/**
 * Register a renderer for a fenced info-string. `render(source, ctx)` may return
 * a Node/DocumentFragment, a Promise resolving to one (for libraries that load
 * or parse asynchronously), or nothing at all if it fills `ctx.host` itself.
 */
export declare function registerBlockRenderer(lang: string, render: RenderBlockFn, opts?: {
    label?: string;
}): void;
export declare function hasBlockRenderer(lang: string): boolean;
export declare function registeredBlockLangs(): string[];
/**
 * Pipeline stage: replace every fenced block whose language has a registered
 * renderer with that renderer's output. Runs after resolveLinks and before
 * highlightWithin. Async renderers mount a placeholder host now and settle later.
 * @param ctx extra fields merged into each renderer call's BlockRenderContext (e.g. `{ docId }`)
 */
export declare function renderBlocks(root: Element, ctx?: Record<string, unknown>): void;
