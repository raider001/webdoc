<script lang="ts">
  import { onMount } from 'svelte';
  import { sourceRuns, watchRuns, loadRunCases, startRun } from '/js/automated-runs.js';
  interface Props { source: string; ids?: string[]; caseId?: string; scope?: 'page' | 'source'; }
  let { source, ids = [], caseId, scope = 'page' }: Props = $props();
  let version = $state(0);
  let loaded = $state(false);
  onMount(() => {
    const off = watchRuns(() => { version++; });
    loadRunCases(source).then(() => { loaded = true; });
    return off;
  });
  const store = $derived.by(() => { void version; const current = sourceRuns(source); return { ...current, cases: { ...current.cases }, runs: current.runs.map(r => ({ ...r, cases: { ...r.cases } })) }; });
  const info = $derived(caseId ? store.cases[caseId] : undefined);
  const selected = $derived(caseId ? [caseId] : (scope === 'source' ? Object.keys(store.cases) : ids).filter(id => store.cases[id]?.runnable));
  const active = $derived(store.runs.findLast(r => r.ids.some(id => selected.includes(id)) && r.state !== 'finished'));
  const latest = $derived(store.runs.findLast(r => r.ids.some(id => selected.includes(id))));
  const automated = $derived(!!info?.automated);
  function manual(): void { document.dispatchEvent(new window.CustomEvent('webdoc:run-test', { detail: { testId: caseId } })); }
</script>

{#if caseId}
  {#if !loaded}<span>Checking automation…</span>
  {:else if automated}
    <span class="tc-automated">Automated</span>
    <span>Automated test: {info?.testName || caseId}</span>
    <span class="tc-automation-result" aria-live="polite">{active?.state || info?.result || 'Untested'}</span>
    <span class="tc-last-run">{info?.lastRun ? 'Last ran: ' + info.lastRun : 'Last real run unknown'}</span>
    {#if info?.duration !== undefined}<span>Duration: {info.duration}s</span>{/if}
    {#if info?.startedBy}<span>Started by: {info.startedBy}</span>{/if}
    <button type="button" class="tc-run" disabled={!info?.runnable || !!active} onclick={() => startRun(source, selected)}>{active?.state || 'Run now'}</button>
    {#if !info?.runnable}<span>Page running is disabled</span>{/if}
    {#if info?.failure || info?.outputTail || latest?.output || latest?.error}<details><summary>Failure and output</summary><pre>{info?.failure || ''}{'\n'}{latest?.error || ''}{'\n'}{latest?.output || info?.outputTail || ''}</pre></details>{/if}
  {:else if !store.error}
    <span class="tc-manual">Manual</span><button type="button" class="tc-run" onclick={manual}>Record manual result</button>
  {/if}
{:else if selected.length}
  <button type="button" class="tc-run-all" disabled={!!active} onclick={() => startRun(source, selected)}>{active ? active.state : scope === 'page' ? 'Run all automated tests on this page' : 'Run all automated tests for ' + source}</button>
  {#if latest}<span aria-live="polite">{latest.state}{latest.state === 'finished' ? ': ' + Object.values(latest.cases).map(c => c.result).join(', ') : ''}</span>{/if}
{/if}
{#if store.error}<p role="alert">{store.error}</p>{/if}
<style>
  span { margin-inline-end: .65em; } .tc-automated, .tc-manual { font-weight: 700; }
  pre { white-space: pre-wrap; max-height: 18em; overflow: auto; } details { text-align: left; }
</style>
