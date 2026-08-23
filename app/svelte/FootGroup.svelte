<!--
  One footer link group - "Assumed knowledge" or "Recommended next" - mounted
  into #footPrev and #footNext respectively.

  Reproduces buildFootGroup() in app/js/reader.js exactly: a `span.foot-cap`
  caption followed by `ul.foot-links > li > a[href="#/id"]`. The caption carries
  its own direction glyph, which is why the old function's `_isNext` argument
  was unused and why nothing equivalent is needed here.

  The `hidden` attribute on the two containers is NOT set here. buildFootGroup()
  wrote `container.hidden` directly, but this component is mounted INTO those
  containers and cannot set an attribute on its own mount target - so the
  vanilla shell keeps writing it. This component renders nothing at all for an
  empty list, which is what makes that split safe: hidden or not, there is no
  stray caption to show.
-->
<script>
  import { state, titleFromId } from '/js/app-shell.js';

  /** @type {{ caption: string, ids?: string[] }} */
  let { caption, ids = [] } = $props();

  /**
   * Lazy boot no longer preloads every document, so a target's real title is
   * only available if that document happens to be in the client cache; an
   * id-derived title stands in otherwise. Existence is not verified either - a
   * dead link simply lands on the not-found view when clicked. Both are
   * buildFootGroup()'s behaviour, deliberately kept.
   *
   * state.byId is a plain Map and not reactive, which is fine: this is read
   * during the render that `ids` triggers, and ids change on every navigation.
   * @param {string} id
   * @returns {string}
   */
  function label(id) {
    const target = state.byId.get(id);
    return (target && target.title) || titleFromId(id);
  }
</script>

{#if ids.length}
  <span class="foot-cap">{caption}</span><ul class="foot-links">{#each ids as id (id)}<li><a href="#/{id}">{label(id)}</a></li>{/each}</ul>
{/if}
