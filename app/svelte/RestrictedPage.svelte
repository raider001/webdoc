<!--
  What a reader sees INSTEAD of a document they may not open.

  It names the groups that WOULD open it, deliberately. The map and the tree
  already show that the page exists - that is not a leak this screen creates - so
  telling the reader who to ask costs nothing and saves a support ticket. What it
  never shows is any of the page's content: the server did not send any.

  Group names come out of the document's own header, so they are author-chosen
  strings; the chips render them as text. The doc id likewise.

  The "Sign in" button calls back into auth-ui.js rather than opening the wall
  itself, because signing in from here is followed by a full page reload that
  must stay in the vanilla shell - see auth-ui.js.
-->
<script>
  import { lockIcon } from '/js/icons.js';
  import { icon } from './actions/icon.js';
  import GroupChip from './GroupChip.svelte';

  /**
   * `detail` is the server's refusal body, forwarded by catalog.loadDoc.
   * `signInRequired` distinguishes "nobody is signed in" from "you are, and it
   * is still not yours" - two different sentences and two different offers.
   * @type {{
   *   docId: string,
   *   detail?: { requiresGroups?: string[], signInRequired?: boolean, error?: string },
   *   onSignIn: () => void,
   * }}
   */
  let { docId, detail = {}, onSignIn } = $props();

  const groups = $derived(detail.requiresGroups || []);
  const needsSignIn = $derived(!!detail.signInRequired);

  // Derived rather than inlined in the markup so the paragraph holds ONE text
  // node, exactly as elem() produced - a multi-line ternary in the template
  // would surround it with whitespace nodes.
  const sub = $derived(needsSignIn
    ? 'Sign in to see whether you have access to this page.'
    : 'Your account does not have read access to this page.');
</script>

<div class="restricted-page">
  <div class="restricted-icon" use:icon={lockIcon}></div>
  <h1 class="restricted-title">This page is restricted</h1>
  <p class="restricted-sub">{sub}</p>
  {#if groups.length}
    <div class="restricted-groups">
      <p class="auth-label">Readable by</p>
      <div class="group-chips">{#each groups as group (group)}<GroupChip name={group} />{/each}</div>
    </div>
  {/if}
  <p class="restricted-id">{docId}</p>
  <div class="auth-actions">
    {#if needsSignIn}<button class="btn btn-primary" onclick={onSignIn}>Sign in</button>{/if}
  </div>
</div>
