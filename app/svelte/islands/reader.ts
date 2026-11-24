// islands/reader.ts - the reading view's satellite mounts: the breadcrumb, the
// "On this page" TOC, and the two footer link groups.
//
// MOUNT ONCE AND DRIVE BY PROPS, not once per document. #crumbs, #tocList,
// #footPrev and #footNext are all declared in app/index.html and live for the
// lifetime of the page; only their CONTENTS change per navigation. Mounting per
// document would mean unmounting the previous instance first - reintroducing
// exactly the empty-and-rebuild churn this phase is removing (`tocList
// .textContent = ''`, `container.textContent = ''`), adding a teardown handle
// for the shell to get wrong, and throwing away the diffing that makes the
// rewrite worth doing. So, as in islands/tree.ts, none of these return a
// handle: there is genuinely nothing to tear down.
//
// The data props are GETTERS over the rune store rather than plain values, and
// that is what makes mount-once work. A component reads a prop through the
// getter inside its own tracking context, so a write to shellState re-renders
// it. Passing shellState.toc by value would freeze the first document's TOC on
// screen for the rest of the session.
import { mount, unmount } from 'svelte';
import Toc from '../Toc.svelte';
import FolderPage from '../FolderPage.svelte';
import type { FolderInfo } from '/js/folders.js';
import Crumbs from '../Crumbs.svelte';
import FootGroup from '../FootGroup.svelte';
import { shellState } from '../stores/shell.svelte.js';

/**
 * @param target - #tocList
 * @param contentEl - the #content pane; TOC clicks look their
 *   heading up inside it, the same scope buildTOC() searched
 */
export function mountToc(target: Element, contentEl: HTMLElement): void {
  mount(Toc, {
    target: target,
    props: { get entries() { return shellState.toc; }, contentEl: contentEl },
  });
}

/**
 * @param target - #crumbs
 */
export function mountCrumbs(target: Element): void {
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
 * @param prevTarget - #footPrev
 * @param nextTarget - #footNext
 */
export function mountFooter(prevTarget: Element, nextTarget: Element): void {
  mount(FootGroup, {
    target: prevTarget,
    props: { caption: ASSUMES_CAPTION, get ids() { return shellState.assumes; } },
  });
  mount(FootGroup, {
    target: nextTarget,
    props: { caption: NEXT_CAPTION, get ids() { return shellState.next; } },
  });
}

/**
 * The generated page for a folder with no page file of its own. Unlike the
 * satellites above this one IS per-navigation - it replaces the article - so it
 * returns a teardown handle, and the caller registers it with the article's
 * mount registry so the next navigation destroys it.
 * @param target - a .wd-mounted host inside #content
 */
export function mountFolderPage(
  target: Element,
  info: FolderInfo,
  opts: { canWrite?: boolean; onCreatePage?: () => void } = {},
): { destroy: () => void } {
  const instance = mount(FolderPage, {
    target: target,
    props: { info: info, canWrite: !!opts.canWrite, onCreatePage: opts.onCreatePage },
  });
  return { destroy: () => unmount(instance) };
}
