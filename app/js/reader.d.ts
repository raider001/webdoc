import type { Doc } from './catalog.js';
/**
 * Record a component mounted inside the article so it can be destroyed when the
 * article is replaced. `host` is the .wd-mounted element it was mounted into.
 */
export declare function registerMounted(host: Element, destroy: () => void): void;
/**
 * Destroy every component mounted inside `root`, then forget them. Safe to call
 * when nothing is registered.
 */
export declare function teardownMounted(root: Element): void;
/**
 * Render `doc` into the reading-view content pane: parse and sanitize its Markdown
 * body, inject the description subtitle, number the headings and build the TOC,
 * fill in the requirement/test-case placeholders, resolve in-body links and images,
 * run any pluggable block renderers and the syntax highlighter, wire up scroll-spy,
 * and refresh the header/footer chrome. The single entry point the shell's router
 * calls on every document navigation.
 */
export declare function renderDoc(doc: Doc): void;
/**
 * Wire the in-document search box: on every input, clear the previous highlights
 * and, once the query reaches 2 characters, highlight all matches in the currently
 * rendered article and smooth-scroll to the first one.
 */
export declare function setupDocSearch(): void;
