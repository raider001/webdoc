// islands/reader.js - the reading view's satellite mounts: the breadcrumb, the
// "On this page" TOC, and the two footer link groups.
//
// MOUNT ONCE AND DRIVE BY PROPS, not once per document. #crumbs, #tocList,
// #footPrev and #footNext are all declared in app/index.html and live for the
// lifetime of the page; only their CONTENTS change per navigation. Mounting per
// document would mean unmounting the previous instance first - reintroducing
// exactly the empty-and-rebuild churn this phase is removing (`tocList
// .textContent = ''`, `container.textContent = ''`), adding a teardown handle
// for the shell to get wrong, and throwing away the diffing that makes the
// rewrite worth doing. So, as in islands/tree.js, none of these return a
// handle: there is genuinely nothing to tear down.
//
// The data props are GETTERS over the rune store rather than plain values, and
// that is what makes mount-once work. A component reads a prop through the
// getter inside its own tracking context, so a write to shellState re-renders
// it. Passing shellState.toc by value would freeze the first document's TOC on
// screen for the rest of the session.
import { mount } from 'svelte';
import Toc from '../Toc.svelte';
import Crumbs from '../Crumbs.svelte';
import FootGroup from '../FootGroup.svelte';
import { shellState } from '../stores/shell.svelte.js';

/**
 * @param {Element} target - #tocList
 * @param {HTMLElement} contentEl - the #content pane; TOC clicks look their
 *   heading up inside it, the same scope buildTOC() searched
 * @returns {void}
 */
export function mountToc(target, contentEl) {
  mount(Toc, {
    target: target,
    props: { get entries() { return shellState.toc; }, contentEl: contentEl },
  });
}

/**
 * @param {Element} target - #crumbs
 * @returns {void}
 */
export function mountCrumbs(target) {
  mount(Crumbs, {
    target: target,
    props: { get docId() { return shellState.docId; } },
  });
}

// The two captions, verbatim from renderFooter(). They are fixed strings, so
// they are passed once at mount and never enter the store - the store holds
// what CHANGES per document, which is only the ids.
const ASSUMES_CAPTION = '‹ Assumed knowledge';
const NEXT_CAPTION = 'Recommended next ›';

/**
 * Both footer groups, mounted together because they are one feature split
 * across two containers by the layout.
 * @param {Element} prevTarget - #footPrev
 * @param {Element} nextTarget - #footNext
 * @returns {void}
 */
export function mountFooter(prevTarget, nextTarget) {
  mount(FootGroup, {
    target: prevTarget,
    props: { caption: ASSUMES_CAPTION, get ids() { return shellState.assumes; } },
  });
  mount(FootGroup, {
    target: nextTarget,
    props: { caption: NEXT_CAPTION, get ids() { return shellState.next; } },
  });
}
