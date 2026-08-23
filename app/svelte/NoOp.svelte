<!--
  The no-op island. Nothing imports it and it renders nothing visible.

  It exists so Phase 1 proves the BUILD, independently of any behaviour change:
  if this compiles, bundles, commits and serves, then every remaining risk in the
  migration is framework risk rather than toolchain risk. Phase 3 replaces it
  with the first real island (the drawer tree).

  It deliberately exercises three things rather than nothing:
   - a prop and a rune, so the compiler is genuinely compiling;
   - an $effect with a real DOM side effect, so the reactive runtime is proven to
     run and not merely to be present;
   - an import from "/js/icons.js", which is THE property this phase exists to
     prove. That specifier must survive into the bundle verbatim as an external
     import, so the browser resolves it natively against the same module main.js
     already loaded. Were it bundled instead, every module reached that way would
     be forked into a second instance with its own state.
-->
<script>
  import { closeIcon } from '/js/icons.js';

  /** @type {{ label?: string }} */
  let { label = 'no-op' } = $props();

  /** @type {HTMLElement|undefined} */
  let node = $state();

  // A side effect on a real node, which is what $effect is actually for. The
  // earlier version assigned to $state from inside the effect - which works, but
  // is the pattern svelte/prefer-writable-derived exists to catch, and this file
  // is the template every later island gets copied from.
  $effect(() => {
    if (node) node.dataset.mounted = 'true';
  });

  // Proves the external import is a live binding, not a bundled copy: calling it
  // returns a fresh SVG element built by the app's own icon module.
  //
  // The ?. is not defensive noise. icons.js builds each icon with a tagged
  // template and returns `.firstElementChild`, which is typed Element|null - so
  // under strict this is a real nullable, and new code is written at strict from
  // its first line rather than inheriting the vanilla tree's looser rung.
  const iconTag = closeIcon()?.tagName ?? '';
</script>

<span class="wd-island-noop" hidden bind:this={node}>{label} {iconTag}</span>
