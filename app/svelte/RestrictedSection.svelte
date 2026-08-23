<!--
  The notice that replaces a section of a page this reader may not see.

  THE SERVER HAS ALREADY REMOVED THE CONTENT (webdoc_access.redact_sections);
  this only renders the hole it left. Nothing withheld passes through here, and
  nothing here decides anything - if this component never ran, the reader would
  see the inert JSON placeholder the server sent instead. Ugly, never leaky, and
  that is the intended failure mode.

  Mounted INSIDE the article, so its host carries `wd-mounted`: reader.js's
  find-in-page, link resolution and image resolution all skip those subtrees, and
  the mount is registered so the next navigation tears it down.

  `spec.label` is authored in the document, and `spec.read` names groups from the
  same place - both attacker-chosen where authors are not fully trusted, both
  rendered as text.
-->
<script>
  import { lockIcon } from '/js/icons.js';
  import { icon } from './actions/icon.js';
  import GroupChip from './GroupChip.svelte';

  /**
   * `malformed` is the server saying the section's access rule could not be
   * parsed. That hides it from everyone but an administrator - a rule nobody can
   * read is treated as a rule nobody satisfies, never as no rule at all.
   * @type {{ spec?: { read?: string[], label?: string, malformed?: boolean } }}
   */
  let { spec = {} } = $props();

  const groups = $derived(spec.read || []);

  // One text node per paragraph, as elem() produced - see RestrictedPage.
  const sub = $derived(spec.malformed
    ? 'This section has an access rule that could not be read, so it is hidden from everyone but an administrator.'
    : groups.length
      ? 'Part of this page is only visible to members of:'
      : 'Part of this page is hidden from your account.');
</script>

<aside class="restricted-section" role="note">
  <span class="restricted-section-icon" use:icon={lockIcon}></span>
  <div class="restricted-section-body">
    <p class="restricted-section-title">{spec.label || 'Restricted section'}</p>
    <p class="restricted-section-sub">{sub}</p>
    {#if groups.length}
      <div class="group-chips">{#each groups as group (group)}<GroupChip name={group} small />{/each}</div>
    {/if}
  </div>
</aside>
