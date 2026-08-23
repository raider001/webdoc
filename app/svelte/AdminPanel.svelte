<!--
  The administrator's account list.

  Groups themselves are declared in config.json and are not editable here; what
  this screen chooses is who is IN them. Every change is applied immediately and
  the list is reloaded from the server afterwards, so what is on screen is always
  the server's answer rather than an optimistic guess - which matters when a
  change signs somebody out mid-request.

  "Add an account…" is deliberately NOT rendered inside this component. Its
  dialog is a second body-level mount owned by islands/auth.js, so its
  `.modal-scrim` stays a SIBLING of this one exactly as openCreateUser() left it
  rather than nesting inside it. The refresh to run once an account exists is
  handed over with the request.
-->
<script>
  import { listUsers, adminUser } from '/js/auth.js';
  import Modal from './Modal.svelte';
  import UserRow from './UserRow.svelte';

  /** @typedef {import('./stores/auth.svelte.js').AdminUser} AdminUser */
  /** @typedef {import('/js/auth.js').GroupSpec} GroupSpec */

  /** @type {{ onClose: () => void, onAddAccount: (onCreated: () => void) => void }} */
  let { onClose, onAddAccount } = $props();

  /**
   * null is LOADING, not empty - a server that answers with no accounts at all
   * must read as an empty list, not as a spinner that never stops.
   * @type {AdminUser[]|null}
   */
  let users = $state(null);
  /** @type {GroupSpec[]} */
  let allGroups = $state([]);
  let failed = $state(false);
  let message = $state('');
  /** @type {''|'is-error'|'is-ok'} */
  let messageKind = $state('');

  /** @returns {Promise<void>} */
  async function refresh() {
    const data = await listUsers();
    if (!data) { failed = true; return; }
    failed = false;
    // A documented downcast, not a silencer: listUsers() is typed as a
    // passthrough of the server's JSON (`Object[]`), and AdminUser is the shape
    // this screen actually reads out of it.
    users = /** @type {AdminUser[]} */ (data.users);
    allGroups = data.groups;
  }

  /**
   * Send one change and report its outcome, then reload. Reload even on failure:
   * a refused change usually means someone else already made a conflicting one,
   * and showing the reason next to stale rows is how an administrator ends up
   * fighting a list that is lying to them.
   * @param {Promise<import('/js/auth.js').AuthReply>} promise
   * @returns {Promise<void>}
   */
  async function apply(promise) {
    const r = await promise;
    messageKind = r.ok ? 'is-ok' : 'is-error';
    message = r.ok ? 'Saved.' : (r.error || 'That did not work.');
    refresh();
  }

  // The first load. Started during init rather than from an effect: there is
  // nothing reactive to wait for, and the list should already be in flight by
  // the time the dialog has finished painting.
  refresh();
</script>

<Modal title="Accounts" wide {onClose}>
  {#snippet body()}
    <div class="auth-panel-body">
      <p class="auth-sub">Groups are declared in config.json; here you choose who is in them. Changing a group or disabling an account signs that person out immediately.</p>
      <div class="admin-list">
        {#if failed}
          <p class="auth-status is-error">Could not load the account list.</p>
        {:else if users === null}
          <p class="auth-muted">Loading…</p>
        {:else}
          {#each users as user (user.username)}
            <UserRow
              {user}
              groups={allGroups}
              onUpdate={patch => apply(adminUser('update', { username: user.username, ...patch }))}
              onDelete={() => apply(adminUser('delete', { username: user.username }))}
            />
          {/each}
        {/if}
      </div>
      <p class="auth-status" class:is-error={messageKind === 'is-error'} class:is-ok={messageKind === 'is-ok'}>{message}</p>
      <div class="auth-actions">
        <button class="btn" onclick={() => onAddAccount(refresh)}>Add an account…</button>
      </div>
    </div>
  {/snippet}
  {#snippet bar()}
    <button class="btn btn-primary" onclick={onClose}>Done</button>
  {/snippet}
</Modal>
