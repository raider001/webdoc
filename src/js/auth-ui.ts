// auth-ui.ts - the vanilla side of every screen accounts need: the sign-in wall,
// the header's user menu, the account panel, the administrator's user list, and
// the two "you may not see this" notices.
// ---------------------------------------------------------------------------
// The pixels moved to app/svelte/ in Phase 5. What is left here is the ADAPTER:
// the shell calls these functions synchronously, they hand back a host element
// or a promise straight away, and the compiled island mounts into that host once
// the bundle has landed. auth.ts still owns the session and the fetch wrapper and
// is untouched by this phase.
//
// THREE THINGS DELIBERATELY DID NOT MOVE, and all three are in this file:
//
//  1. location.reload(), three times. state.byId holds document BODY TEXT that
//     the server redacted for the PREVIOUS principal, and auth.ts's access cache
//     has no TTL and is not cleared on sign-in or sign-out. Swapping a reload for
//     a reactive re-render would leave both in place and show the new identity
//     the old identity's content - a data leak, not a rendering glitch. A reload
//     is the only purge that is complete by construction. Each site is marked
//     below.
//
//  2. The choice of WHICH screen is dismissible. The sign-in wall has no Escape
//     handler and no click-to-dismiss; the dialogs have both. That is a property
//     of two different components (SignInWall.svelte vs Modal.svelte), and this
//     file is what keeps them apart - see mountSignInWall below.
//
//  3. groupChip(). editor/panels.js and editor/widgets.js import it by that name
//     and call it synchronously for a DOM element; the editor is out of scope for
//     the migration, so the name, the signature and the return type all stand.
//
// Attacker-chosen strings - usernames, display names, group labels, and the
// server's own error sentences - are still only ever rendered as text. Svelte's
// {expr} is the same guarantee elem()'s text children gave, and eslint refuses
// {@html} anywhere under app/svelte/.
// ---------------------------------------------------------------------------
import { elem } from './dom.js';
import { el, app } from './app-shell.js';
import { auth, signOut, signInRequired, onAuthChange } from './auth.js';
import { loadIslands } from './islands.js';
import type { RestrictedDetail } from './catalog.js';

/**
 * A host element for a component mounted into DOM the shell owns.
 *
 * `wd-mounted` is display:contents, so the host is not a box: the component's
 * own root lays out exactly where the hand-built element used to, whether that
 * is a fixed-position scrim, a flex item in a `.group-chips` row, or a block in
 * the article. It is also the marker reader.ts's post-render passes skip.
 */
function mountHost<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] { return elem(tag, 'wd-mounted'); }

// ---- group chips ----------------------------------------------------------
/**
 * Instances keyed by the host the caller is holding. A WeakMap, so a host that
 * is dropped without a destroyGroupChip() call takes its entry with it.
 */
const chipInstances = new WeakMap<Element, { destroy: () => void }>();
/**
 * Hosts destroyed BEFORE the bundle finished loading. The mount has to be
 * cancelled rather than merely undone: mounting into a detached host would start
 * effects nothing would ever stop.
 */
const chipCancelled = new WeakSet<Element>();

/**
 * A coloured chip naming one access group. The single place a group is drawn, so
 * the map legend, the locked-page screen and the admin list all agree.
 *
 * RETURNS THE HOST, not the chip inside it. That is the whole contract: the host
 * is what identifies the instance, so returning host.firstElementChild would
 * throw away Svelte's anchor node and the handle with it - the component could
 * then never be unmounted and would never update. Callers append the host and
 * pass that same host back to destroyGroupChip().
 *
 * The mount is asynchronous because the bundle is loaded lazily and there is no
 * synchronous way to import it. In practice it has already been loaded by boot,
 * so the chip appears in the next microtask.
 */
export function groupChip(name: string, opts?: { small?: boolean, title?: string }): HTMLElement {
  const host = mountHost('span');
  loadIslands().then(mod => {
    if (chipCancelled.has(host)) return;
    chipInstances.set(host, mod.mountGroupChip(host, name, opts));
  });
  return host;
}

/**
 * Destroy the chip mounted in `host` - the element groupChip() returned. Call it
 * before dropping the host: the editor redraws its chip rows on every checkbox
 * change, and a cleared container detaches nodes without stopping the components
 * inside them.
 */
export function destroyGroupChip(host: Element): void {
  if (!host) return;
  const instance = chipInstances.get(host);
  if (instance) { chipInstances.delete(host); instance.destroy(); return; }
  // The bundle has not landed yet; leave a note for the pending mount instead.
  chipCancelled.add(host);
}

// ---- the sign-in wall -----------------------------------------------------
/**
 * True while a wall is on screen (or on its way). Not a node handle on purpose:
 * the wall is the one screen nothing may dismiss from the outside, so there is
 * deliberately no exported way to take it down. It removes itself when, and only
 * when, there is a real session.
 */
let wallUp = false;

/**
 * Put up the full-screen sign-in / registration screen. `target` is normally
 * document.body.
 *
 * `onSignedIn` fires once, after the wall has already been removed. On a server
 * that allows neither sign-in nor registration (registration closed, no account)
 * it simply stays up, which is the correct end state.
 *
 * NOT a modal. `.auth-wall` has no Escape handler and no scrim click, unlike the
 * dialogs below - boot() is suspended behind this screen, and dismissing it would
 * drop the visitor onto an empty shell that then fires library fetches the server
 * refuses one at a time.
 */
export function mountSignInWall(target: Element, opts: { onSignedIn: () => void }): void {
  if (wallUp) return;
  wallUp = true;
  loadIslands().then(mod => {
    mod.mountSignInWall(target, {
      onSignedIn: () => { wallUp = false; opts.onSignedIn(); },
    });
  }, () => {
    // The bundle failed to load. Clearing the latch is all that can be done
    // here; boot()'s own catch reports the failure to the visitor.
    wallUp = false;
  });
}

/**
 * The promise-shaped form of mountSignInWall, for the two places that continue
 * with `.then(() => location.reload())`. Resolves once the visitor is signed in.
 *
 * A wall that is ALREADY up resolves immediately rather than queueing a second
 * waiter - the behaviour of the screen this replaces.
 */
export function showSignInWall(): Promise<void> {
  if (wallUp) return Promise.resolve();
  return new Promise<void>(resolve => {
    mountSignInWall(document.body, { onSignedIn: () => resolve() });
  });
}

// ---- the header's account button -----------------------------------------
/**
 * Wire the header account button: it shows who is signed in, and opens the
 * account panel. Hidden entirely when the server has accounts switched off, so a
 * server without auth looks exactly as it did before.
 *
 * The button's CONTENTS are an island; its `hidden`, `title`, `aria-label` and
 * click handler stay here, because a component cannot set attributes on the
 * element it was mounted into - and because the signed-out branch of the click
 * ends in a reload that must not move into the bundle.
 */
export function setupAccountButton(): void {
  const btn = el('accountBtn');
  if (!btn) return;
  const render = () => {
    btn.hidden = !auth.enabled;
    if (!auth.enabled) return;
    if (auth.user) {
      btn.title = auth.user.displayName + ' (' + auth.user.username + ')';
      btn.setAttribute('aria-label', 'Account: ' + auth.user.displayName);
    } else {
      btn.title = 'Sign in';
      btn.setAttribute('aria-label', 'Sign in');
    }
  };
  btn.addEventListener('click', () => (auth.user
    ? openAccountPanel()
    // RELOAD 1 of 3. Signing in from the header happens with a document already
    // rendered from state.byId - a body the server redacted for the anonymous
    // reader - and with auth.ts's access cache full of anonymous answers. Both
    // have to go before the new identity sees anything.
    : showSignInWall().then(() => location.reload())));
  onAuthChange(render);
  render();
  // The contents follow the session on their own, through the island store's
  // own onAuthChange subscription; render() above never touches them.
  loadIslands().then(mod => mod.mountAccountButton(btn));
}

// ---- the account panel ----------------------------------------------------
export function openAccountPanel(): void {
  if (!auth.user) return;
  loadIslands().then(mod => mod.openAccountPanel({
    // RELOAD 2 of 3. Signing out is the direction that matters most: everything
    // already rendered was fetched as somebody, and the anonymous reader must
    // not inherit it.
    onSignOut: () => signOut().then(() => location.reload()),
  }));
}

// ---- the administrator's user list ---------------------------------------
export function openAdminPanel(): void {
  loadIslands().then(mod => mod.openAdminPanel());
}

// ---- the restricted-page screen ------------------------------------------
/**
 * What a reader sees INSTEAD of a document they may not open. `detail` is the
 * server's own explanation, exactly as catalog.ts's RestrictedError carried it.
 *
 * Returns the host straight away so the caller can put it where the article was;
 * the component mounts into it a microtask later. The mount is registered with
 * reader.ts through the app registry (not by importing reader.ts, which imports
 * this file) so the next navigation tears it down.
 */
export function restrictedPanel(docId: string, detail: RestrictedDetail): HTMLElement {
  const host = mountHost('div');
  loadIslands().then(mod => {
    // Routed away again before the bundle landed: mounting now would start
    // effects against a detached node that nothing will ever tear down, because
    // the teardown for this article already ran.
    if (!host.isConnected) return;
    const instance = mod.mountRestrictedPage(host, docId, detail || {}, {
      // RELOAD 3 of 3. Same reason as the header button, plus one more: the map
      // and the tree were built from the anonymous index and would still be
      // showing it.
      onSignIn: () => showSignInWall().then(() => location.reload()),
    });
    if (app.registerMounted) app.registerMounted(host, instance.destroy);
  });
  return host;
}

/**
 * What the server left behind in place of a section this reader may not see: the
 * groups that would have opened it, the section's label, and the `malformed`
 * flag it sets when the marker itself could not be parsed. A type alias rather
 * than an interface so it still reads as the plain JSON record the island takes.
 */
export type RestrictedSectionSpec = {
  read?: string[];
  label?: string;
  malformed?: boolean;
};

/**
 * The notice that replaces a section this reader may not see. The SERVER has
 * already removed the content; this only renders the hole it left.
 */
export function restrictedSection(spec: RestrictedSectionSpec): HTMLElement {
  const host = mountHost('div');
  loadIslands().then(mod => {
    if (!host.isConnected) return;   // the article was replaced first; see above
    const instance = mod.mountRestrictedSection(host, spec || {});
    if (app.registerMounted) app.registerMounted(host, instance.destroy);
  });
  return host;
}

/**
 * Re-run whatever depends on the signed-in identity. Exported so main.ts can
 * hook the header up without importing the internals.
 */
export function wallNeeded(): boolean { return signInRequired(); }
