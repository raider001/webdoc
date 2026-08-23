<!--
  Edit connections: the toggle, and the hint that explains the gesture.

  THE HINT IS DERIVED, NEVER WRITTEN. Drawing a connection is two clicks on a
  canvas with no affordance of its own - the reader is told what to click and
  nothing on screen would contradict a stale instruction. So the text is computed
  from the state the controller REPORTS, which means there is no path through the
  state machine that can leave it wrong. The hand-written chrome updated it at
  five different transitions; the sixth is the bug this shape cannot have.

  Both elements are absolutely positioned by app/css/graph.css and are siblings
  rather than nested for that reason - the hint sits above the toggle, not inside
  it, so it can be as wide as it needs to be.

  The `hidden` attribute, not an {#if}: tests/test_map_ui.py asserts the hint is
  hidden and then that it contains a particular phrase, and an element that does
  not exist yet has neither property in a way a reader of that test would expect.
-->
<script>
  import { icon } from './actions/icon.js';
  import { editIcon } from '/js/icons.js';

  /** @typedef {import('/js/graph.js').GraphChangeEvent} GraphChangeEvent */

  /**
   * The whole change event, not four unpacked fields: every one of them feeds
   * the same sentence, and passing them separately would invite a caller to send
   * a connector from one moment and a pending source from another.
   * @type {{ state: GraphChangeEvent, onToggle: () => void }}
   */
  let { state, onToggle } = $props();

  /**
   * The instruction under the toggle, for whatever the state machine is showing.
   * @param {GraphChangeEvent} s
   * @returns {string}
   */
  function hintFor(s) {
    if (!s.editMode) return '';
    if (s.selectedEdge) return 'Connection selected — press Delete to remove it.';
    if (s.pendingSourceTitle) {
      return s.connector === 'prereq'
        ? 'Now click the document “' + s.pendingSourceTitle + '” should assume (its prerequisite).'
        : 'Now click the document to read next after “' + s.pendingSourceTitle + '”.';
    }
    return s.connector === 'prereq'
      ? 'Prerequisite: click a document, then the one it assumes. (Or click a line + Delete.)'
      : 'Recommended next: click a document, then the one to read next. (Or click a line + Delete.)';
  }

  const hint = $derived(hintFor(state));
</script>

<button
  type="button"
  class="graph-edit-toggle"
  class:is-on={state.editMode}
  aria-pressed={state.editMode ? 'true' : 'false'}
  title="Draw or delete connections between documents"
  onclick={onToggle}
><span class="wd-mounted" use:icon={editIcon}></span> Edit connections</button>

<div class="graph-edit-hint" hidden={!state.editMode}>{hint}</div>
