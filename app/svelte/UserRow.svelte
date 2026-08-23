<!--
  One row of the administrator's account list: identity, the group checkboxes,
  and the two dangerous switches (administrator, disabled) kept visually apart
  from them by `.admin-flags`.

  Usernames and display names are chosen by whoever created the account, so both
  are attacker-chosen strings; they are rendered as text and nothing else. The
  same is true of the group labels the chips draw.

  The row decides nothing. It reports an intent - a group set, a flag, a delete -
  and AdminPanel is what turns that into a request and shows the outcome; the
  server re-checks every one of them regardless.
-->
<script>
  import GroupChip from './GroupChip.svelte';

  /** @typedef {import('./stores/auth.svelte.js').AdminUser} AdminUser */

  /**
   * @type {{
   *   user: AdminUser,
   *   groups: import('/js/auth.js').GroupSpec[],
   *   onUpdate: (patch: Record<string, unknown>) => void,
   *   onDelete: () => void,
   * }}
   */
  let { user, groups, onUpdate, onDelete } = $props();

  /**
   * Ticks this row has sent but the server has not confirmed yet, or null when
   * there are none.
   *
   * A reader can tick two boxes faster than the round-trip, and the second
   * request must carry the first tick as well - the old row got that by
   * re-reading its own checkboxes before building the payload. `null` means
   * "nothing pending, believe the server".
   * @type {string[]|null}
   */
  let pending = $state(null);

  /** What the checkboxes show: the pending set if there is one, else the server's. */
  const chosen = $derived(pending || user.groups || []);

  // A refreshed account list is the server's verdict on everything sent so far,
  // so it supersedes the pending set. The effect tracks `user.groups` and only
  // that: AdminPanel replaces the whole users array on every refresh, so a new
  // array lands here even when the contents are identical.
  $effect(() => {
    void user.groups;
    pending = null;
  });

  /**
   * @param {string} name
   * @param {boolean} on
   * @returns {void}
   */
  function toggleGroup(name, on) {
    const next = on ? [...chosen, name] : chosen.filter(g => g !== name);
    pending = next;
    onUpdate({ groups: next });
  }

  /** @returns {void} */
  function confirmDelete() {
    if (!window.confirm('Delete the account "' + user.username + '"? This cannot be undone.')) return;
    onDelete();
  }
</script>

<div class="admin-row" class:is-disabled={user.disabled}>
  <div class="admin-who">
    <span class="admin-name">{user.displayName || user.username}</span>
    <span class="admin-id">@{user.username}</span>
    {#if user.disabled}<span class="auth-badge is-warn">Disabled</span>{/if}
  </div>
  <div class="admin-groups">
    {#each groups as spec (spec.name)}
      <label class="admin-group">
        <input
          type="checkbox"
          checked={chosen.indexOf(spec.name) !== -1}
          onchange={ev => toggleGroup(spec.name, ev.currentTarget.checked)}
        /><GroupChip name={spec.name} small />
      </label>
    {/each}
  </div>
  <div class="admin-flags">
    <label class="admin-flag"><input
      type="checkbox"
      checked={!!user.admin}
      onchange={ev => onUpdate({ admin: ev.currentTarget.checked })}
    />Administrator</label>
    <label class="admin-flag"><input
      type="checkbox"
      checked={!!user.disabled}
      onchange={ev => onUpdate({ disabled: ev.currentTarget.checked })}
    />Disabled</label>
    <button class="btn btn-danger btn-sm" onclick={confirmDelete}>Delete</button>
  </div>
</div>
