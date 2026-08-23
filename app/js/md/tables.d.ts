import type { MdBlockNode, MdTableBlock } from './blocks.js';
import type { RefDefinition } from './blockpost.js';
/**
 * Walk the block tree, converting qualifying paragraphs into table blocks.
 */
export declare function extractTables(block: MdBlockNode): void;
/**
 * Render a `table` block to HTML.
 */
export declare function renderTable(b: MdTableBlock, refs: Record<string, RefDefinition>): string;
