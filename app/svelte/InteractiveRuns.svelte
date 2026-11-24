<script lang="ts">
  import { onMount } from 'svelte';
  import { isReadOnly } from '/js/policy.js';
  import { loadStylesheet } from '/js/styles.js';
  import type { Component } from 'svelte';
  interface Props { source: string; ids?: string[]; caseId?: string; scope?: 'page' | 'source'; }
  let props: Props = $props();
  let Controls = $state<Component<Props> | null>(null);
  onMount(() => {
    let alive = true;
    if (!isReadOnly()) Promise.all([
      import('./RunControls.svelte'),
      loadStylesheet('/css/automated-runs.css'),
    ]).then(([mod]) => { if (alive) Controls = mod.default; });
    return () => { alive = false; };
  });
</script>
{#if Controls}<Controls {...props} />{/if}
