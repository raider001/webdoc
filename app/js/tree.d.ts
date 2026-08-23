/**
 * One document reference as listed by a tree level - just enough to render a
 * link (id + display title). Distinct from the fuller `Doc` (catalog.ts) and
 * `GraphDocNode` (graph-model.ts) shapes: the server's GET /api/index/tree only
 * ever sends these two fields.
 */
export interface TreeDoc {
    id: string;
    title: string;
    /** present and true when this account may see the page exists but not read it */
    locked?: boolean;
}
/**
 * One folder level of the lazy tree, as returned by GET /api/index/tree: the
 * immediate child folder names plus the docs directly inside this folder.
 */
export interface TreeLevel {
    folders: string[];
    docs: TreeDoc[];
}
export declare function fetchChildren(path: string): Promise<TreeLevel>;
