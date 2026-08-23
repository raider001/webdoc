<!--
  A coloured chip naming one access group.

  The single place a group is drawn, so the map legend, the locked-page screen,
  the account panel and the admin list all agree. Reproduces auth-ui.js's
  groupChip() exactly: `span.group-chip(.is-small) > span.group-dot + text`,
  with the dot's colour as an inline background.

  The group's NAME is attacker-chosen - it comes out of a document header or the
  account list - so the label is a text node and nothing else. Svelte's {label}
  is the same guarantee elem()'s text child gave, which is why this component is
  a straight port rather than a rewrite.

  Colour and label both come from /js/auth.js, external and shared with the
  vanilla shell: groupColor() derives a stable hue from the name and reads the
  --group-sat / --group-light theme tokens for the rest, so the palette envelope
  stays theme-controlled and nothing here hardcodes a colour.
-->
<script lang="ts">
  import { groupColor, groupLabel } from '/js/auth.js';

  /**
   * `title` is the chip's tooltip, used by the map legend to explain what a
   * group is; it is undefined almost everywhere else, and an undefined attribute
   * is simply not rendered.
   */
  type Props = {
    name: string;
    small?: boolean;
    title?: string;
  };

  let { name, small = false, title = undefined }: Props = $props();

  // Derived, not computed once: the label comes from config.json's group list,
  // which arrives with /api/auth/me - so a chip drawn before the policy landed
  // would otherwise keep showing the raw group name forever.
  const color = $derived(groupColor(name));
  const label = $derived(groupLabel(name));
</script>

<span class="group-chip" class:is-small={small} {title}><span class="group-dot" style="background: {color}"></span>{label}</span>
