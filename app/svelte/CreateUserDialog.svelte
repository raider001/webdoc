<!--
  "Add an account" - the administrator's way to create an account directly,
  bypassing registration and approval.

  The new account starts with NO groups on purpose: creating an account and
  granting it access are two decisions, and rolling them into one form is how an
  administrator grants more than they meant to. Groups are assigned afterwards,
  from the list this dialog returns to.

  Mounted as its own body-level host by islands/auth.js, so its `.modal-scrim`
  is a sibling of the account list's rather than nested inside it - the shape
  openCreateUser() produced.
-->
<script lang="ts">
  import { adminUser } from '/js/auth.js';
  import Modal from './Modal.svelte';

  /**
   * `onCreated` is the account list's refresh; `onClose` tears this dialog down.
   *
   * A type alias rather than an interface, deliberately: islands/auth.ts mounts
   * this dialog through a helper constrained to `Record<string, unknown>`, and only
   * an object literal type gets the implicit index signature that satisfies.
   */
  type Props = {
    onClose: () => void;
    onCreated: () => void;
  };

  let { onClose, onCreated }: Props = $props();

  // Its own id prefix. This dialog and the account panel can be open together,
  // and #newUser / #newPass / #newName were literals before - two forms on one
  // page meant duplicate ids and labels that focused the wrong box.
  const uid = $props.id();

  let username = $state('');
  let password = $state('');
  let display = $state('');
  let busy = $state(false);
  let message = $state('');

  let userBox: HTMLInputElement | undefined = $state();

  // Matches openCreateUser()'s deferred focus: the dialog is appended and
  // focused a beat later, so the browser has finished laying it out first.
  $effect(() => {
    // window-qualified: app/svelte/ is linted with the browser globals it
    // actually declares, and the bare timer functions are not among them.
    const t = window.setTimeout(() => { if (userBox) userBox.focus(); }, 30);
    return () => window.clearTimeout(t);
  });

  async function create(): Promise<void> {
    busy = true;
    const r = await adminUser('create', {
      username: username.trim(), password: password, displayName: display.trim(),
    });
    busy = false;
    if (!r.ok) {
      // The server's own sentence, as text. It quotes back the username it was
      // sent, which is why it can never be treated as markup.
      message = r.error || 'That did not work.';
      return;
    }
    onCreated();
    onClose();
  }
</script>

<Modal title="Add an account" {onClose}>
  {#snippet body()}
    <div class="auth-panel-body">
      <div class="modal-field">
        <label for="{uid}-user">Username</label>
        <input type="text" id="{uid}-user" autocomplete="off" bind:value={username} bind:this={userBox} />
      </div>
      <div class="modal-field">
        <label for="{uid}-pass">Password</label>
        <input type="password" id="{uid}-pass" autocomplete="new-password" bind:value={password} />
      </div>
      <div class="modal-field">
        <label for="{uid}-name">Display name (optional)</label>
        <input type="text" id="{uid}-name" autocomplete="off" bind:value={display} />
      </div>
      <p class="auth-hint">The account starts with no groups. Assign them from the account list.</p>
      <p class="auth-status" class:is-error={!!message}>{message}</p>
    </div>
  {/snippet}
  {#snippet bar()}
    <button class="btn" onclick={onClose}>Cancel</button>
    <button class="btn btn-primary" onclick={create} disabled={busy}>Create</button>
  {/snippet}
</Modal>
