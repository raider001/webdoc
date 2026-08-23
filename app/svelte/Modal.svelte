<!--
  The shared modal shell for the account screens: a scrim, a box, a title, a body
  and a button bar.

  A straight port of auth-ui.js's modal() helper, including both of its DISMISSAL
  paths - Escape, and a click on the scrim itself. That is worth stating out loud
  because the sign-in wall deliberately has NEITHER, and reusing this component
  for it would silently make a wall that must not be dismissible dismissible. See
  SignInWall.svelte, which is a separate component for exactly that reason.

  DOM contract, unchanged from modal(): `div.modal-scrim > div.modal(.modal-wide)
  > h2 + <body> + div.modal-bar > <buttons>`. The h2 carries no class - app.css
  styles it by descent - and .modal-scrim / .modal / .modal-bar / .modal-field
  all live in app/css/editor.css, shared with the editor's own modals.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * `onClose` is the only way out. The component never removes itself: it is
   * mounted by islands/auth.js into a host element that islands/auth.js also
   * owns, so the code that created the host is the code that destroys it. A
   * component that unmounted itself would leave that host behind.
   */
  type Props = {
    title: string;
    wide?: boolean;
    onClose: () => void;
    body: Snippet;
    bar: Snippet;
  };

  let { title, wide = false, onClose, body, bar }: Props = $props();

  /**
   * Close on a click on the scrim itself, never on one that bubbled up out of
   * the box - the identity test is what tells "clicked the backdrop" apart from
   * "clicked something inside the dialog".
   */
  function onScrim(ev: MouseEvent): void {
    if (ev.target === ev.currentTarget) onClose();
  }

  /**
   * Escape closes. Registered in the CAPTURE phase, as modal() did, so it runs
   * before the drawer's and the editor's own Escape handlers and can stop the
   * event reaching them - otherwise dismissing a dialog would also collapse
   * whatever is behind it.
   *
   * stopPropagation, NOT stopImmediatePropagation: when the create-user dialog
   * is stacked on the admin panel, both are listening on `document` and both
   * close. That is the behaviour modal() had, and it is the right one - the
   * stacked pair is one task, and Escape abandons it.
   */
  function onKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    onClose();
  }
</script>

<svelte:document onkeydowncapture={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-scrim" onclick={onScrim}>
  <div class="modal" class:modal-wide={wide}>
    <h2>{title}</h2>
    {@render body()}
    <div class="modal-bar">{@render bar()}</div>
  </div>
</div>
