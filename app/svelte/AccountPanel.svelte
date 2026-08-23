<!--
  The "Your account" dialog: who you are, which access groups you hold, the way
  into the admin screen, and the change-password form.

  Everything drawn here is server-supplied and account-controlled - a display
  name, a username, group labels, and the sentence the server returns when a
  password change is refused. All of it goes through {expr} as text.

  The dialog does NOT sign anybody out itself: it calls back into auth-ui.js,
  because signing out is followed by a full page reload that must stay in the
  vanilla shell. See auth-ui.js for why that reload cannot become a reactive
  transition.
-->
<script lang="ts">
  import { changePassword } from '/js/auth.js';
  import { authView } from './stores/auth.svelte.js';
  import Modal from './Modal.svelte';
  import GroupChip from './GroupChip.svelte';

  /**
   * A type alias rather than an interface, deliberately: islands/auth.ts mounts
   * this panel through a helper constrained to `Record<string, unknown>`, and only
   * an object literal type gets the implicit index signature that satisfies.
   */
  type Props = {
    onClose: () => void;
    onManage: () => void;
    onSignOut: () => void;
  };

  let { onClose, onManage, onSignOut }: Props = $props();

  // Unique per instance: the panel and the create-user dialog can be on screen
  // together, and both used to hard-code their input ids.
  const uid = $props.id();

  // Read through the mirror so the panel follows a change made elsewhere - an
  // administrator editing their own groups in the admin list, for instance.
  // Flattened into plain locals because `user` is nullable and the markup is
  // easier to read without a guard around every field.
  const user = $derived(authView.user);
  const displayName = $derived(user ? user.displayName : '');
  const username = $derived(user ? user.username : '');
  const isAdmin = $derived(!!(user && user.admin));
  const groups = $derived((user && user.groups) || []);

  let current = $state('');
  let next = $state('');
  let busy = $state(false);
  let message = $state('');
  let messageKind: '' | 'is-error' | 'is-ok' = $state('');

  async function onChange(ev: SubmitEvent): Promise<void> {
    ev.preventDefault();
    busy = true;
    messageKind = '';
    message = 'Changing…';
    const r = await changePassword(current, next);
    busy = false;
    messageKind = r.ok ? 'is-ok' : 'is-error';
    message = r.ok ? 'Password changed.' : (r.error || 'That did not work.');
    // Only on success. Leaving a rejected attempt in the boxes is what lets
    // someone fix a typo instead of retyping both fields.
    if (r.ok) { current = ''; next = ''; }
  }
</script>

<Modal title="Your account" {onClose}>
  {#snippet body()}
    <div class="auth-panel-body">
      <div class="auth-who">
        <div class="auth-who-name">{displayName}</div>
        <div class="auth-who-id">@{username}</div>
        {#if isAdmin}<span class="auth-badge">Administrator</span>{/if}
      </div>
      <p class="auth-label">Your access groups</p>
      <div class="group-chips">
        {#each groups as group (group)}<GroupChip name={group} />{:else}<span class="auth-muted">No groups</span>{/each}
      </div>
      {#if isAdmin}<button class="btn" onclick={onManage}>Manage accounts…</button>{/if}
      <hr class="auth-rule" />
      <p class="auth-label">Password</p>
      <form class="auth-pw" onsubmit={onChange}>
        <div class="modal-field">
          <label for="{uid}-current">Current password</label>
          <input type="password" id="{uid}-current" autocomplete="current-password" bind:value={current} />
        </div>
        <div class="modal-field">
          <label for="{uid}-next">New password</label>
          <input type="password" id="{uid}-next" autocomplete="new-password" bind:value={next} />
        </div>
        <div class="auth-actions">
          <button class="btn" type="submit" disabled={busy}>Change password</button>
        </div>
      </form>
      <p class="auth-status" class:is-error={messageKind === 'is-error'} class:is-ok={messageKind === 'is-ok'}>{message}</p>
    </div>
  {/snippet}
  {#snippet bar()}
    <button class="btn" onclick={onSignOut}>Sign out</button>
    <button class="btn btn-primary" onclick={onClose}>Done</button>
  {/snippet}
</Modal>
