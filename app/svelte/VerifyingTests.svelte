<!--
  "Test cases (n)" - the test cases that verify one requirement, in the coverage
  report panel.

  READ-ONLY PLUS A LINK BOX. The list is a requirement's CALCULATED `verifiedBy`
  (the inverse of every test's authored `verifies`), so nothing here can create a
  test case - test cases are written in documents and in the editor. What it can
  do is join two existing things up: the search box links an existing test to
  this requirement, and the ✕ unlinks one. Both edit the TEST's document, which
  is why they go through the `app` registry rather than writing anything here.

  An exact reproduction of buildVerifyingTests() in app/js/coverage-report.js:
  `div.cov-report-sec.cov-vtests > h3 + div.cov-vtest-list + div.cov-vtest-add +
  div.cov-vtest-drop`, each entry a `div.cov-vtest > button.cov-vtest-open +
  button.cov-vtest-rm`. tests/test_coverage_ui.py asserts the heading's count
  agrees with the list under it, so both are derived from one array.

  The list is not local state. It is read back out of requirementList() after
  every successful edit (through the `version` token the parent bumps), because
  the server's index is what decides what is linked - guessing locally would show
  a link that a failed write never made.
-->
<script>
  import { closeIcon, checkIcon, circleIcon } from '/js/icons.js';
  import { app } from '/js/app-shell.js';
  import { requirementList, testList } from '/js/requirements.js';
  import { computeTestStatus } from '/js/coverage.js';
  import { icon } from './actions/icon.js';

  /** @typedef {import('/js/coverage.js').CoverageResults} CoverageResults */

  /**
   * `version` is the parent's rebuild token, read INSIDE the deriveds below.
   * requirementList() and testList() are plain functions over plain Maps -
   * Svelte cannot see them change - so the token is what tells this component
   * that a link or unlink landed. Same pattern, same reason, as
   * stores/coverage.svelte.js's covStatus.version.
   * @type {{
   *   reqId: string,
   *   results: CoverageResults,
   *   version: number,
   *   onOpenTest: (id: string) => void,
   *   onChanged: () => void,
   * }}
   */
  let { reqId, results, version, onOpenTest, onChanged } = $props();

  /** The last thing an edit had to say, shown beside the search box. */
  let note = $state('');
  /** Which test id is mid-unlink; its ✕ is disabled until the write answers. */
  let busy = $state('');
  let query = $state('');
  let dropOpen = $state(false);

  const linked = $derived.by(() => {
    const rec = (version, requirementList()).find(r => r.id === reqId);
    return (rec && rec.verifiedBy) || [];
  });

  /** Status per test id, for the dot in front of each entry. */
  const tstatus = $derived(computeTestStatus((version, testList()), results));

  /**
   * @param {string} tid
   * @returns {string}
   */
  function statusOf(tid) {
    const st = tstatus.get(tid);
    return (st && st.status) || 'untested';
  }

  /**
   * @param {string} status
   * @returns {() => Element}
   */
  function glyph(status) {
    return status === 'pass' ? checkIcon : status === 'fail' ? closeIcon : circleIcon;
  }

  /**
   * @param {string} tid
   * @returns {string}
   */
  function nameOf(tid) {
    const t = (version, testList()).find(x => x.id === tid);
    return t ? t.name : tid;
  }

  /**
   * The eight best unlinked candidates for the drop-down. Capped exactly as the
   * hand-built list was: this is a picker, not a browser.
   */
  const options = $derived.by(() => {
    const already = new Set(linked);
    const q = query.trim().toLowerCase();
    return (version, testList())
      .filter(t => !already.has(t.id) && (!q || t.id.toLowerCase().includes(q) || (t.name || '').toLowerCase().includes(q)))
      .slice(0, 8);
  });

  /**
   * @param {string} tid
   * @returns {Promise<void>}
   */
  async function unlink(tid) {
    // The registry entry is optional in the type because the module that fills
    // it (authoring.js) loads independently; an unwired button says so rather
    // than throwing inside a click handler.
    if (!app.unlinkTestFromRequirement) return;
    busy = tid;
    note = 'Unlinking…';
    const ok = await app.unlinkTestFromRequirement(tid, reqId);
    note = ok ? 'Unlinked ' + tid : 'Unlink failed';
    busy = '';
    if (ok) onChanged();
  }

  /**
   * @param {MouseEvent} ev
   * @param {string} tid
   * @returns {Promise<void>}
   */
  async function link(ev, tid) {
    // mousedown, not click, and the default is prevented: the box below is still
    // focused, and letting the press blur it would hide this option before the
    // click ever landed.
    ev.preventDefault();
    if (!app.linkTestToRequirement) return;
    dropOpen = false;
    query = '';
    note = 'Linking…';
    const ok = await app.linkTestToRequirement(tid, reqId);
    note = ok ? 'Linked ' + tid : 'Link failed';
    if (ok) onChanged();
  }

  /**
   * The blur close is delayed because a click on an option is a blur followed by
   * a mousedown, and closing on the blur would remove the option first.
   * @returns {void}
   */
  function closeSoon() {
    window.setTimeout(() => { dropOpen = false; }, 160);
  }
</script>

<div class="cov-report-sec cov-vtests">
  <h3>Test cases ({linked.length})</h3>
  <div class="cov-vtest-list">
    {#if !linked.length}<p class="cov-report-empty">No test cases verify this requirement yet.</p>{/if}
    {#each linked as tid (tid)}
      <div class="cov-vtest">
        <button type="button" class="cov-vtest-open" title="Open {tid}" onclick={() => onOpenTest(tid)}>
          <span class="cov-vtest-dot tc-result-{statusOf(tid)}" use:icon={glyph(statusOf(tid))}></span>
          <span class="cov-vtest-name">{nameOf(tid)}</span>
          <span class="cov-vtest-id">{tid}</span>
        </button>
        <button
          type="button"
          class="cov-vtest-rm"
          title="Unlink this test from the requirement"
          disabled={busy === tid}
          onclick={() => unlink(tid)}
          use:icon={closeIcon}
        ></button>
      </div>
    {/each}
  </div>
  <div class="cov-vtest-add">
    <input
      class="cov-vtest-search"
      placeholder="Search to link an existing test…"
      bind:value={query}
      oninput={() => { dropOpen = true; }}
      onfocus={() => { dropOpen = true; }}
      onblur={closeSoon}
    />
    <span class="cov-medit-status">{note}</span>
  </div>
  <div class="cov-vtest-drop" hidden={!dropOpen || !options.length}>
    {#each options as t (t.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="cov-vtest-opt" onmousedown={ev => link(ev, t.id)}>
        <span class="cov-vtest-optname">{t.name || t.id}</span>
        <span class="cov-vtest-optid">{t.id}</span>
      </div>
    {/each}
  </div>
</div>
