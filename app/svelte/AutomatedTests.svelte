<!--
  "Automated tests (n)" - the xUnit side of the coverage report panel, shown for
  a requirement and for a test case alike.

  TWO KINDS OF ENTRY, and the difference is who claimed the link:

    DECLARED   the xUnit result names the requirement itself (a test named after
               the id, or a property in the report). Read-only: nothing here
               connected it, so nothing here can disconnect it.
    CONNECTED  a person picked it out of the discovered catalogue. Removable,
               and stored in the per-source sidecar.

  A connected test hides the declared entry with the same name, so one automated
  test is never listed twice.

  An exact reproduction of buildAutomated() in app/js/coverage-report.js:
  `div.cov-report-sec.cov-auto > h3 + div.cov-auto-list + div.cov-vtest-add +
  div.cov-vtest-drop + div.cov-auto-url`.

  Every write here changes a sidecar the server owns, so each one is followed by
  a full reload rather than a local edit - `onReload` is the parent's, and it
  refetches results and rebuilds the graph. The one exception is "add an xUnit
  URL", which only DISCOVERS tests: the catalogue grows in place and nothing is
  connected until the reader picks one.
-->
<script lang="ts">
  import { checkIcon, closeIcon, circleIcon } from '/js/icons.js';
  import { state as appState } from '/js/app-shell.js';
  import { testsFor, connectAutomated, disconnectAutomated, rememberAutoUrl, fetchXUnitCatalog } from '/js/coverage.js';
  import { icon } from './actions/icon.js';

  import type { AutoTestCatalogEntry, AutoTestRef, CoverageResults } from '/js/coverage.js';

  /**
   * `id` is a requirement id OR a test-case id - the automated section is the
   * same for both, because an xUnit test can be attached to either.
   */
  interface Props {
    id: string;
    results: CoverageResults;
    onReload: () => Promise<void>;
  }

  let { id, results, onReload }: Props = $props();

  let note = $state('');
  /** The catalog key of the entry mid-disconnect; its ✕ is disabled meanwhile. */
  let busy = $state('');
  let query = $state('');
  let dropOpen = $state(false);
  let url = $state('');
  let fetching = $state(false);

  /**
   * The catalogue key. Classname + name is what identifies an xUnit case across
   * reports; the sidecar stores the same pair.
   */
  const keyOf = (tc: AutoTestRef): string => (tc.classname || '') + ' ' + (tc.name || '');

  const connected = $derived((results.autoLinks && results.autoLinks[id]) || []);

  /** Declared entries the connected list already covers are dropped. */
  const declared = $derived.by(() => {
    const names = new Set(connected.map(tc => tc.name));
    return ((testsFor(id, results).auto) || []).filter(a => !names.has(a.name));
  });

  /**
   * A connected test's status comes from the CATALOGUE, not from the link: the
   * link is a name, and whether that name passed is whatever the latest report
   * said. An entry no report mentions is untested rather than failed.
   */
  function catStatus(key: string): string {
    const e = (results.autoCatalog || []).find(c => c.key === key);
    return e ? (e.pass ? 'pass' : 'fail') : 'untested';
  }

  function glyph(status: string): () => Element {
    return status === 'pass' ? checkIcon : status === 'fail' ? closeIcon : circleIcon;
  }

  const options = $derived.by(() => {
    const already = new Set(connected.map(keyOf));
    const q = query.trim().toLowerCase();
    return (results.autoCatalog || [])
      .filter(c => !already.has(c.key) &&
        (!q || (c.name || '').toLowerCase().includes(q) || (c.classname || '').toLowerCase().includes(q)))
      .slice(0, 8);
  });

  /**
   * `?? []` in the three sidecar calls below, where each used to read
   * `appState.site && appState.site.sources`: connectAutomated,
   * disconnectAutomated and rememberAutoUrl all declare `SourceConfig[]` and all
   * hand it straight to sourceForId, which opens `for (const s of (sources ||
   * []))` and then asks for `sources[0]`. Both null and an empty list find no
   * source name and return false; the null was never the point.
   */
  async function disconnect(tc: AutoTestRef): Promise<void> {
    busy = keyOf(tc);
    note = 'Disconnecting…';
    const ok = await disconnectAutomated(id, tc, appState.site?.sources ?? []);
    busy = '';
    if (ok) await onReload();
  }

  async function connect(ev: MouseEvent, c: AutoTestCatalogEntry): Promise<void> {
    ev.preventDefault();   // keep the search box focused; see VerifyingTests.svelte
    dropOpen = false;
    query = '';
    note = 'Connecting…';
    const ok = await connectAutomated(id, c, appState.site?.sources ?? []);
    if (ok) await onReload();
  }

  /**
   * Pull an external xUnit report in and MERGE its cases into the live
   * catalogue, keyed, so re-adding the same URL refreshes rather than
   * duplicates. Nothing is connected by this - the reader still has to pick.
   */
  async function addUrl(): Promise<void> {
    const href = url.trim();
    if (!href) return;
    fetching = true;
    note = 'Fetching…';
    const cat = await fetchXUnitCatalog(href);
    fetching = false;
    if (!cat.length) { note = 'No xUnit tests found at that URL.'; return; }
    // Built in one pass rather than by mutation: a later entry with the same key
    // wins, which is exactly the refresh-don't-duplicate behaviour wanted here.
    const merged = new Map<string, AutoTestCatalogEntry>([...(results.autoCatalog || []), ...cat].map((c): [string, AutoTestCatalogEntry] => [c.key, c]));
    results.autoCatalog = [...merged.values()];
    await rememberAutoUrl(href, id, appState.site?.sources ?? []);
    url = '';
    note = 'Added ' + cat.length + ' tests — search to connect.';
    dropOpen = true;
  }

  function onUrlKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    addUrl();
  }

  function closeSoon(): void {
    window.setTimeout(() => { dropOpen = false; }, 160);
  }
</script>

<div class="cov-report-sec cov-auto">
  <h3>Automated tests ({connected.length + declared.length})</h3>
  <div class="cov-auto-list">
    {#if !connected.length && !declared.length}<p class="cov-report-empty">No automated tests connected.</p>{/if}
    {#each connected as tc (keyOf(tc))}
      <div class="cov-vtest">
        <div class="cov-vtest-open cov-auto-info">
          <span class="cov-vtest-dot tc-result-{catStatus(keyOf(tc))}" use:icon={glyph(catStatus(keyOf(tc)))}></span>
          <span class="cov-vtest-name">{tc.name}</span>
          <span class="cov-vtest-id">{tc.classname || tc.suite || ''}</span>
        </div>
        <button
          type="button"
          class="cov-vtest-rm"
          title="Disconnect this automated test"
          disabled={busy === keyOf(tc)}
          onclick={() => disconnect(tc)}
          use:icon={closeIcon}
        ></button>
      </div>
    {/each}
    {#each declared as a (a.name)}
      <div class="cov-vtest cov-auto-declared">
        <div class="cov-vtest-open cov-auto-info">
          <span class="cov-vtest-dot tc-result-{a.pass ? 'pass' : 'fail'}" use:icon={a.pass ? checkIcon : closeIcon}></span>
          <span class="cov-vtest-name">{a.name}</span>
          <span class="cov-vtest-id">declared</span>
        </div>
      </div>
    {/each}
  </div>
  <div class="cov-vtest-add">
    <input
      class="cov-vtest-search"
      placeholder="Search automated tests to connect…"
      bind:value={query}
      oninput={() => { dropOpen = true; }}
      onfocus={() => { dropOpen = true; }}
      onblur={closeSoon}
    />
    <span class="cov-medit-status">{note}</span>
  </div>
  <div class="cov-vtest-drop" hidden={!dropOpen || !options.length}>
    {#each options as c (c.key)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="cov-vtest-opt" onmousedown={ev => connect(ev, c)}>
        <span class="cov-vtest-optname">{c.name}</span>
        <span class="cov-vtest-optid">{(c.classname || c.suite || '') + ' '}<span class="wd-mounted" use:icon={c.pass ? checkIcon : closeIcon}></span></span>
      </div>
    {/each}
  </div>
  <div class="cov-auto-url">
    <input class="cov-vtest-search" placeholder="Add an external xUnit URL…" bind:value={url} onkeydown={onUrlKey} />
    <button type="button" class="blk-small" disabled={fetching} onclick={addUrl}>Add</button>
  </div>
</div>
