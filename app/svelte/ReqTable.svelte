<!--
  One requirement group, rendered INSIDE the article.

  An exact reproduction of buildReqTable() / reqRow() in
  app/js/requirements/render.js, which this replaces: `figure.req-group >
  figcaption.req-cap + div.req-scroll > table.req-tbl`, five fixed columns, a
  `tr#req-<ID>` per row and a `span.req-badge` carrying the composed id. Those
  names are the DOM contract - app/css/requirements.css styles them,
  requirements.js's revealRequirement() looks a row up by that id, and
  tests/test_coverage_ui.py selects on all of it.

  WHAT THIS COMPONENT OWNS: the table structure, the id badge and its status
  colour, and the trace links. WHAT IT DOES NOT OWN: the description prose. That
  is author-written Markdown, and it is rendered by the app's own sanitizing
  pipeline and injected with `use:fragment` - see app/svelte/actions/fragment.js
  for why a component that produced its own HTML here would be either
  double-escaped or an XSS hole.

  THE BADGE REPAINT. `covStatus.version` is read in the SAME expression as
  statusOf() so that replacing the coverage-status map recolours every badge on
  the spot. statusOf() reads a plain Map in a plain module that Svelte cannot
  track; without the version read a badge would render once and then be wrong
  for the rest of the session. See app/svelte/stores/coverage.svelte.js.
-->
<script>
  import { warningIcon } from '/js/icons.js';
  import { index, testIndex, statusOf } from '/js/requirements/store.js';
  import { resolveReqRef, cssSafe } from '/js/requirements/parse.js';
  import { icon } from './actions/icon.js';
  import { fragment } from './actions/fragment.js';
  import { covStatus } from './stores/coverage.svelte.js';

  /** @typedef {import('/js/requirements.js').RequirementEntry} RequirementEntry */

  /**
   * One rendered reference in a trace cell. `id` is null when the authored
   * reference resolved to nothing, which is the "missing" chip rather than a
   * link - a broken trace has to be visible, not silently absent.
   * @typedef {Object} TraceRef
   * @property {string|null} id
   * @property {string} raw - the reference exactly as authored, for the chip
   * @property {string} href
   * @property {string} cls
   */

  /**
   * The parsed block, straight from requirements/store.js's groupsByDoc. Passed
   * whole rather than destructured into props so this component and the parser
   * cannot drift apart over what a group IS.
   * @type {{ block: import('/js/requirements/parse.js').ReqGroupBlock }}
   */
  let { block } = $props();

  const HEADERS = ['Requirement', 'Description', 'Trace To', 'Trace From', 'Verified By'];

  /**
   * A requirement's own route. The record is assumed present - every id reaching
   * here came out of the index or was resolved against it - but a missing one
   * degrades to a dead '#' rather than throwing: this runs inside mount(), and an
   * exception here would abandon the rest of the article's tables, which is a far
   * worse failure than one link that goes nowhere.
   * @param {string} id
   * @returns {string}
   */
  function reqHref(id) {
    const rec = index.get(id);
    return rec ? '#/' + rec.docId + '?req=' + encodeURIComponent(id) : '#';
  }
  /**
   * A test case's route - a different document and a different query key.
   * @param {string} id
   * @returns {string}
   */
  function testHref(id) {
    const rec = testIndex.get(id);
    return rec ? '#/' + rec.docId + '?test=' + encodeURIComponent(id) : '#';
  }

  /**
   * Trace To: resolved against THIS row (a bare `2` means the same group), so it
   * is the only cell that can produce a missing chip.
   * @param {RequirementEntry} rec
   * @returns {TraceRef[]}
   */
  function traceTo(rec) {
    return rec.traceTo.map(raw => {
      const id = resolveReqRef(raw, rec);
      return { id: id, raw: raw, href: id ? reqHref(id) : '', cls: 'req-link' };
    });
  }
  /**
   * Trace From: the calculated inverse, already composed ids from the server.
   * @param {string[]} ids
   * @returns {TraceRef[]}
   */
  function reqRefs(ids) {
    return (ids || []).map(id => ({ id: id, raw: id, href: reqHref(id), cls: 'req-link' }));
  }
  /**
   * Verified By: also calculated, but they are TEST ids - hence the extra
   * `tc-link` class the stylesheet colours differently.
   * @param {string[]} ids
   * @returns {TraceRef[]}
   */
  function testRefs(ids) {
    return (ids || []).map(id => ({ id: id, raw: id, href: testHref(id), cls: 'req-link tc-link' }));
  }

  /**
   * The status modifier appended to `req-badge`, or '' for no status at all.
   * Returned as a suffix (with its own leading space) rather than through a
   * class: directive so the class attribute is byte-identical to what
   * badgeStatus() produced - `req-badge` alone when coverage has not loaded.
   *
   * Reads covStatus.version in the same expression as statusOf(); see the file
   * header.
   * @param {string} id
   * @returns {string}
   */
  function badgeMod(id) {
    const cur = (covStatus.version, statusOf(id));
    return cur ? ' req-badge-st-' + cur.status : '';
  }

  /**
   * Only a row that composed a REAL id is addressable. A group with no component
   * (an unconfigured source) or no group name produced ids nothing can link to,
   * and stamping those onto the DOM would create duplicate or nonsense anchors.
   * @param {RequirementEntry} rec
   * @returns {string|undefined}
   */
  function rowId(rec) {
    return (rec.component && rec.group) ? 'req-' + cssSafe(rec.id) : undefined;
  }
</script>

<!--
  The comma-joined contents of one trace cell, or the em-dash placeholder. An
  empty cell and a cell with nothing to say look different on purpose: the
  placeholder is how a reader knows the column was considered.
-->
{#snippet trace(/** @type {TraceRef[]} */ refs)}{#if refs.length}{#each refs as ref, i (i)}{#if i}, {/if}{#if ref.id}<a class={ref.cls} href={ref.href}>{ref.id}</a>{:else}<span class="req-missing" title="Not found: {ref.raw}"><span class="wd-mounted" use:icon={warningIcon}></span> {ref.raw}</span>{/if}{/each}{:else}<span class="req-none">—</span>{/if}{/snippet}

<!--
  KEYED BY INDEX, deliberately. `block` is a parsed snapshot of one document and
  never changes for the lifetime of this mount - a new document means a new
  component - so there is no reordering for a key to help with. The obvious key,
  rec.id, would be actively worse: ids are composed from AUTHORED numbers, two
  rows in one group can carry the same one, and Svelte throws on a duplicate key,
  which would turn a typo in a table into a document that fails to render.
-->
<figure class="req-group">
  <figcaption class="req-cap">Requirements — {block.group}</figcaption>
  {#if block.error}<p class="req-error"><span class="wd-mounted" use:icon={warningIcon}></span> {block.error}</p>{/if}
  <div class="req-scroll">
    <table class="req-tbl">
      <thead><tr>{#each HEADERS as h (h)}<th>{h}</th>{/each}</tr></thead>
      <tbody>
        {#each block.rows as rec, i (i)}
          <tr id={rowId(rec)}>
            <td class="req-idcell"><span class="req-badge{badgeMod(rec.id)}">{rec.id}</span></td>
            <td use:fragment={{ text: rec.description, inline: true }}></td>
            <td>{@render trace(traceTo(rec))}</td>
            <td>{@render trace(reqRefs(rec.traceFrom))}</td>
            <td>{@render trace(testRefs(rec.verifiedBy))}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</figure>
