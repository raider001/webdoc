// islands/auth.ts - the account screens' mount surface.
//
// Two kinds of island live here, and the difference matters:
//
//   - MOUNT-ONCE. The account button's contents (#accountBtn is declared in
//     app/index.html and lives for the whole session) and the two restricted
//     screens, whose hosts the shell creates and hands over. These follow
//     islands/tree.ts: the caller keeps the handle, or there is nothing to keep.
//
//   - OVERLAYS. The sign-in wall and the three dialogs. Each gets its OWN host
//     element appended to <body>, and destroying the component removes that host
//     again - so the code that created a node is the code that removes it, which
//     is the discipline app/js/islands.js exists to impose.
//
// Every host carries class="wd-mounted" (display:contents). It is not a box:
// `.auth-wall` and `.modal-scrim` are position:fixed and `.restricted-page` /
// `.restricted-section` are laid out by their parent, so wrapping them in a
// normal <div> would change all four. display:contents makes the wrapper
// disappear from layout entirely and the markup lays out exactly as the
// hand-built DOM did.
//
// WHAT IS NOT HERE: every location.reload(). The account button, the sign-out
// button and the restricted page's "Sign in" button all reach one, and all three
// stay in app/js/auth-ui.js as callbacks. See that file for why replacing them
// with a reactive transition would leak the previous principal's content.
import { mount, unmount } from 'svelte';
import type { Component } from 'svelte';
import SignInWall from '../SignInWall.svelte';
import AccountButton from '../AccountButton.svelte';
import AccountPanel from '../AccountPanel.svelte';
import AdminPanel from '../AdminPanel.svelte';
import CreateUserDialog from '../CreateUserDialog.svelte';
import RestrictedPage from '../RestrictedPage.svelte';
import RestrictedSection from '../RestrictedSection.svelte';
import GroupChip from '../GroupChip.svelte';
import { startAuthSync } from '../stores/auth.svelte.js';

/**
 * A host element that takes up no space of its own.
 */
function host(tag: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = 'wd-mounted';
  return node;
}

/**
 * Mount a self-closing dialog into a fresh body-level host.
 *
 * The close function is what the component is given and what this function
 * returns, so there is exactly ONE way to dismiss a dialog however it was
 * dismissed - Escape, the scrim, "Done", or the panel that opened it deciding to
 * step aside. The `closed` latch matters because several of those can happen in
 * the same tick: "Manage accounts…" closes the account panel from inside a click
 * handler that Escape may also be closing.
 * @returns close
 */
function overlay<P extends Record<string, unknown>>(
  Component: Component<P>,
  makeProps: (close: () => void) => P,
): () => void {
  startAuthSync();
  const node = host('div');
  document.body.appendChild(node);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    unmount(instance);
    node.remove();
  };
  const instance = mount(Component, { target: node, props: makeProps(close) });
  return close;
}

/**
 * The full-screen sign-in wall. Tears itself down BEFORE reporting success, so
 * that by the time boot() resumes the wall is already off the page.
 * @param target - <body>; the wall is fixed-position, so this is only
 *   about where the host node lives
 */
export function mountSignInWall(target: Element, opts: { onSignedIn: () => void }): void {
  startAuthSync();
  const node = host('div');
  target.appendChild(node);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    unmount(instance);
    node.remove();
    opts.onSignedIn();
  };
  const instance = mount(SignInWall, { target: node, props: { onSignedIn: finish } });
}

/**
 * The header account button's CONTENTS. #accountBtn itself keeps its `hidden`,
 * `title`, `aria-label` and click handler in auth-ui.js - a component cannot set
 * attributes on its own mount target, and the click leads to a reload.
 *
 * No handle: the button outlives everything, exactly like the drawer islands.
 * @param target - #accountBtn
 */
export function mountAccountButton(target: Element): void {
  startAuthSync();
  mount(AccountButton, { target: target });
}

/**
 * "Your account".
 * @param opts - onSignOut runs after the panel closes;
 *   auth-ui.js signs out and reloads
 */
export function openAccountPanel(opts: { onSignOut: () => void }): void {
  overlay(AccountPanel, close => ({
    onClose: close,
    // Close first, then open the list: the two are alternatives, not a stack.
    onManage: () => { close(); openAdminPanel(); },
    onSignOut: () => { close(); opts.onSignOut(); },
  }));
}

/**
 * The administrator's account list. The create dialog it opens is a SEPARATE
 * body-level overlay, so the two scrims are siblings as they were before.
 */
export function openAdminPanel(): void {
  overlay(AdminPanel, close => ({
    onClose: close,
    onAddAccount: (onCreated: () => void) => {
      overlay(CreateUserDialog, closeCreate => ({ onClose: closeCreate, onCreated: onCreated }));
    },
  }));
}

/**
 * The restricted-page screen, mounted into a host the shell has already put in
 * place of the article.
 * @param target - a .wd-mounted host inside #content
 */
export function mountRestrictedPage(
  target: Element,
  docId: string,
  detail: { requiresGroups?: string[]; signInRequired?: boolean; error?: string },
  opts: { onSignIn: () => void },
): { destroy: () => void } {
  startAuthSync();
  const instance = mount(RestrictedPage, {
    target: target,
    props: { docId: docId, detail: detail, onSignIn: opts.onSignIn },
  });
  return { destroy: () => unmount(instance) };
}

/**
 * One in-document "this section is restricted" notice.
 * @param target - a .wd-mounted host inside the article
 */
export function mountRestrictedSection(
  target: Element,
  spec: { read?: string[]; label?: string; malformed?: boolean },
): { destroy: () => void } {
  const instance = mount(RestrictedSection, { target: target, props: { spec: spec } });
  return { destroy: () => unmount(instance) };
}

/**
 * One group chip. The only island the EDITOR reaches, through auth-ui.js's
 * groupChip() adapter - editor/panels.js and editor/widgets.js both call it and
 * are permanently out of scope for this migration.
 * @param target - a .wd-mounted host the caller owns
 */
export function mountGroupChip(
  target: Element,
  name: string,
  opts?: { small?: boolean; title?: string },
): { destroy: () => void } {
  const instance = mount(GroupChip, {
    target: target,
    props: { name: name, small: !!(opts && opts.small), title: opts && opts.title },
  });
  return { destroy: () => unmount(instance) };
}
