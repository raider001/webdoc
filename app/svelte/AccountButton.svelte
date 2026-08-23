<!--
  The CONTENTS of the header's account button (#accountBtn) - the signed-in
  account's initials, or the generic user icon when nobody is.

  Only the contents. #accountBtn itself is declared in app/index.html, and its
  `hidden`, `title`, `aria-label` and click handler stay in app/js/auth-ui.js:
  a component cannot set attributes on the element it was mounted into, and the
  click has to reach a `location.reload()` that must NOT move into the bundle
  (see auth-ui.js for why). This is the same split SearchHitList and FootGroup
  already use.

  The display name is chosen by whoever created the account, so it is
  attacker-chosen; initials() only ever produces text, and {label} renders it as
  a text node.
-->
<script lang="ts">
  import { userIcon } from '/js/icons.js';
  import { icon } from './actions/icon.js';
  import { authView } from './stores/auth.svelte.js';

  const user = $derived(authView.user);
  const label = $derived(user ? initials(user.displayName || user.username) : '');

  /**
   * Up to two leading letters, upper-cased - "Ada Lovelace" -> "AL", "root" ->
   * "R". The '?' fallback matters: a display name of "!!!" has no letters at
   * all, and an empty button would look broken rather than anonymous.
   */
  function initials(name: string): string {
    const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
    return parts.map(p => p[0] || '').join('').toUpperCase() || '?';
  }
</script>

{#if user}
  <span class="account-initial">{label}</span>
{:else}
  <!--
    .wd-mounted is display:contents, so this wrapper is not a box: the <svg> stays
    the button's own flex item exactly as it was when auth-ui.js appended it
    directly. The wrapper exists only because `use:` needs an element to attach
    to, and icons.js returns a fresh node per call rather than markup.
  -->
  <span class="wd-mounted" use:icon={userIcon}></span>
{/if}
