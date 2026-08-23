import type { MdBlockNode } from './blocks.js';
import type { RefDefinition } from './blockpost.js';
/**
 * PHASE 2 entry point: render a parsed document's block tree to an HTML string.
 * @param doc the document root block, as returned by parseDocument
 */
export declare function renderTree(doc: MdBlockNode, refs: Record<string, RefDefinition>): string;
