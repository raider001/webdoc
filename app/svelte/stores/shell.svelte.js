// shell.svelte.js - state for the three satellites of the reading view: the
// breadcrumb trail, the "On this page" TOC, and the two footer link groups.
//
// This replaces four direct DOM writes at the tail of app/js/reader.js's
// renderDoc(): the `tocList.textContent = ''` + `appendChild(buildTOC(...))`
// pair, `el('crumbs').textContent = ...`, and renderFooter()'s two
// buildFootGroup() calls (each of which began by emptying its container). Every
// one of them threw the panel away and rebuilt it on every navigation; here a
// navigation is three assignments and the components patch what differs.
//
// What deliberately does NOT move here is the render pipeline. numberHeadings()
// still walks the sanitized article, injects the `.secnum` labels and assigns
// the heading ids - that MUTATES DOCUMENT CONTENT, which is nothing to do with
// these three panels. Only its return value lands in `toc`.
//
// Note for the wiring step: writes here are applied asynchronously, so anything
// that reads the produced DOM in the same tick (setupScrollSpy's
// `tocList.querySelectorAll('a[data-target]')` is the one that matters) must
// flushSync() first or run after the update.
//
// The `.svelte.js` extension is required - it is what tells the compiler to
// process runes in a plain module rather than treat $state as an undefined name.

/** @typedef {import('/js/numbering.js').TocEntry} TocEntry */

/**
 * @typedef {Object} ShellState
 * @property {string} docId - the routed document; the breadcrumb is its id, segment by segment
 * @property {TocEntry[]} toc - the flat heading list numberHeadings() returned, in document order
 * @property {string[]} assumes - doc ids for the "Assumed knowledge" footer group
 * @property {string[]} next - doc ids for the "Recommended next" footer group
 */

/** @type {ShellState} */
export const shellState = $state({ docId: '', toc: [], assumes: [], next: [] });

/**
 * The routed document, for the breadcrumb.
 * @param {string} docId
 * @returns {void}
 */
export function setCrumbs(docId) { shellState.docId = docId; }

/**
 * The current document's headings. Replaces the array rather than mutating it:
 * the list is rebuilt wholesale per document anyway, and a single assignment is
 * one update instead of N.
 * @param {TocEntry[]} toc
 * @returns {void}
 */
export function setToc(toc) { shellState.toc = toc; }

/**
 * Both footer groups at once, because they are always set together - they are
 * the current document's own `assumes` and `next` metadata, and a document with
 * neither must clear both.
 * @param {string[]} assumes
 * @param {string[]} next
 * @returns {void}
 */
export function setFootLinks(assumes, next) {
  shellState.assumes = assumes || [];
  shellState.next = next || [];
}
