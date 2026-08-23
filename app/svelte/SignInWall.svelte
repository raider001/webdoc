<!--
  The full-screen sign-in / registration screen.

  NOT A MODAL, and not built on Modal.svelte. `.auth-wall` has no Escape handler
  and no click-to-dismiss on purpose: it is what a locked-out visitor sees
  INSTEAD of the library, and boot() is suspended behind it. A dismissible wall
  would drop the visitor onto an empty shell that then fires library fetches the
  server refuses one by one - trading "no request made" for "request made and
  denied". Modal.svelte has both dismissal paths; sharing it here would have made
  that regression invisible.

  Everything a visitor types on this screen is attacker-chosen, and so is every
  sentence the server sends back (`result.error`). All of it is rendered as text
  through {expr}; nothing on this path may ever become markup.
-->
<script>
  // ALIASED, and it has to be. Svelte reads `$state` as a store subscription to
  // a local binding called `state` whenever one is in scope, so importing
  // app-shell's `state` under its own name turns every `$state(...)` in this
  // file into a store read - the compiler warns, and every rune in the component
  // silently stops being reactive. FootGroup.svelte imports the same object and
  // gets away with it only because it declares no state of its own.
  import { state as appState } from '/js/app-shell.js';
  import { signIn, register } from '/js/auth.js';
  import { authView } from './stores/auth.svelte.js';

  /**
   * `onSignedIn` fires exactly once, when there is a real session. islands/auth.js
   * unmounts this component and removes its host in response - the wall never
   * removes itself, because it does not own the node it was mounted into.
   * @type {{ onSignedIn: () => void }}
   */
  let { onSignedIn } = $props();

  // ONE id prefix per instance. The old screen hard-coded #authUser / #authPass /
  // #authName, which already collided with the account panel's #pwCurrent-era
  // fields the moment two of these screens were on the page together - and a
  // duplicate id makes `<label for>` point at whichever element the browser
  // happened to see first, so clicking a label focused the wrong box.
  const uid = $props.id();

  /**
   * 'sign-in' or 'register'. Seeded from the mirror rather than derived from it:
   * a server with no accounts at all opens on the register form, but the visitor
   * may switch modes freely afterwards and the seed must not fight them.
   * @type {'sign-in'|'register'}
   */
  let mode = $state(authView.needsBootstrap ? 'register' : 'sign-in');
  let username = $state('');
  let password = $state('');
  let display = $state('');
  let busy = $state(false);
  let message = $state('');
  /** @type {''|'is-error'|'is-ok'} */
  let messageKind = $state('');

  /** @type {HTMLInputElement|undefined} */
  let userBox = $state();
  /** @type {HTMLInputElement|undefined} */
  let passBox = $state();

  const registering = $derived(mode === 'register');

  // The switch offer is hidden when registration is closed, and also during
  // bootstrap - the first account is not a choice, it is the only thing that
  // can happen, so offering "I already have an account" would be a lie.
  const switchHidden = $derived(!authView.allowRegistration || authView.needsBootstrap);

  const hint = $derived(
    authView.needsBootstrap
      ? 'This server has no accounts yet. The first account created becomes the administrator.'
      : !registering ? ''
        : authView.requireApproval
          ? 'New accounts must be approved by an administrator before they can sign in.'
          : 'Passwords must be at least ' + authView.passwordMinLength + ' characters.');

  // The old screen focused the username box 30ms after appending the wall. Kept
  // as a timer rather than the `autofocus` attribute: the wall is appended in the
  // middle of boot, and an immediate focus() competes with whatever the browser
  // is doing to the page it is still laying out.
  $effect(() => {
    // window-qualified: app/svelte/ is linted with the browser globals it
    // actually declares, and the bare timer functions are not among them.
    const t = window.setTimeout(() => { if (userBox) userBox.focus(); }, 30);
    return () => window.clearTimeout(t);
  });

  /** @returns {void} */
  function toggleMode() {
    mode = registering ? 'sign-in' : 'register';
    message = '';
    messageKind = '';
  }

  /**
   * @param {SubmitEvent} ev
   * @returns {Promise<void>}
   */
  async function onSubmit(ev) {
    ev.preventDefault();
    if (busy) return;
    busy = true;
    messageKind = '';
    message = registering ? 'Creating your account…' : 'Signing in…';
    const result = registering
      ? await register(username.trim(), password, display.trim())
      : await signIn(username.trim(), password);
    busy = false;

    if (!result.ok) {
      messageKind = 'is-error';
      message = result.error || 'That did not work.';
      password = '';
      if (passBox) passBox.focus();
      return;
    }
    if (result.pendingApproval) {
      // A 202: the account exists but there is no session, so this screen stays
      // up and drops back to the sign-in form for whenever approval lands.
      messageKind = 'is-ok';
      message = result.message || 'Your account is waiting for approval.';
      mode = 'sign-in';
      password = '';
      return;
    }
    onSignedIn();
  }
</script>

<div class="auth-wall" role="dialog" aria-modal="true" aria-label="Sign in">
  <div class="auth-card">
    <div class="auth-brand">{(appState.site && appState.site.siteTitle) || 'Documentation'}</div>
    <h1 class="auth-title">Sign in to continue</h1>
    <p class="auth-sub">This library is private. Sign in to read and edit documents.</p>
    <form class="auth-form" onsubmit={onSubmit}>
      <div class="modal-field">
        <label for="{uid}-user">Username</label>
        <input type="text" id="{uid}-user" autocomplete="username" required bind:value={username} bind:this={userBox} />
      </div>
      <div class="modal-field">
        <label for="{uid}-pass">Password</label>
        <input
          type="password"
          id="{uid}-pass"
          autocomplete={registering ? 'new-password' : 'current-password'}
          required
          bind:value={password}
          bind:this={passBox}
        />
      </div>
      <div class="modal-field" hidden={!registering}>
        <label for="{uid}-name">Display name (optional)</label>
        <input type="text" id="{uid}-name" autocomplete="name" bind:value={display} />
      </div>
      <p class="auth-status" class:is-error={messageKind === 'is-error'} class:is-ok={messageKind === 'is-ok'}>{message}</p>
      <div class="auth-actions">
        <button class="btn btn-primary" type="submit" disabled={busy}>{registering ? 'Create account' : 'Sign in'}</button>
      </div>
      <p class="auth-switch" hidden={switchHidden}>
        <button class="auth-link" type="button" onclick={toggleMode}
          >{registering ? 'I already have an account' : 'Create an account'}</button>
      </p>
      <p class="auth-hint">{hint}</p>
    </form>
  </div>
</div>
