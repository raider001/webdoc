import type { MdBlockNode, MdParagraphBlock } from './blocks.js';
/**
 * One resolved link-reference-definition (`[label]: url "title"`), stored in
 * the refs map keyed by normalized label; looked up in md/inline.js when a
 * reference-style link/image `[text][label]` is closed.
 */
export interface RefDefinition {
    url: string;
    title: string | null;
}
/**
 * Peel any leading link reference definitions off a paragraph, registering
 * them, and return whether inline content still remains (so the caller knows
 * if there is a heading/paragraph left to build). Used when a setext underline
 * arrives before the block post-pass has run.
 */
export declare function stripLeadingRefs(para: MdParagraphBlock, refs: Record<string, RefDefinition>): boolean;
/**
 * Walk the block tree collecting link reference definitions from paragraphs
 * (same peeling logic as stripLeadingRefs, applied tree-wide after the line loop).
 */
export declare function collectRefs(block: MdBlockNode, refs: Record<string, RefDefinition>): void;
/**
 * Walk the block tree, deciding which lists render tight vs loose.
 */
export declare function detectTightness(block: MdBlockNode): void;
