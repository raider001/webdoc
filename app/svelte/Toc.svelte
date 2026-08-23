<!--
  The "On this page" list, mounted into #tocList.

  An exact reproduction of buildTOC() in app/js/numbering.js, which this replaces:
  `ol > li.lvl-N > a[href="#id"][data-target="id"] > span.n + text`. Two parts of
  that are load-bearing beyond the styling:

    - `data-target` is what app/js/reader.js's setupScrollSpy() selects on
      (`tocList.querySelectorAll('a[data-target]')`) to map each heading back to
      its entry. It also adds and removes the `.active` class on these anchors
      directly - that is left as vanilla DOM on purpose, because it fires on
      every scroll frame and has no business round-tripping through the store.
    - `span.n` is asserted by tests/test_e2e.py's test_heading_numbers_match_toc,
      which compares `#tocList a .n` against the headings' data-heading-number.

  The <ol> is rendered unconditionally, exactly as buildTOC() always returned one
  even for a document with no headings.
-->
<script>
  /** @typedef {import('/js/numbering.js').TocEntry} TocEntry */

  /**
   * `contentEl` is the reading pane the headings live in. It is a prop rather
   * than a document.getElementById() call so the lookup stays scoped to the
   * rendered article - the same scope buildTOC() searched - and so the component
   * is testable without the app shell around it.
   * @type {{ entries?: TocEntry[], contentEl: HTMLElement }}
   */
  let { entries = [], contentEl } = $props();

  /**
   * Scroll to the heading and put focus on it, without touching the router hash
   * - the href is only there so the entry behaves like a link (hover, status
   * bar, open-in-new-tab). Identical to buildTOC()'s handler: smooth scroll,
   * then a tabindex="-1" + preventScroll focus so the next Tab continues from
   * the heading instead of jumping back to the top of the document.
   * @param {MouseEvent} ev
   * @param {TocEntry} entry
   * @returns {void}
   */
  function jump(ev, entry) {
    ev.preventDefault();
    /** @type {HTMLElement|null} */
    const target = contentEl.querySelector('#' + cssEscape(entry.id));
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }

  /**
   * STILL NEEDED, despite the ids being slugified. slugify() in
   * app/js/numbering.js strips everything outside [\w\s-], so an id is safe as
   * an id - but not necessarily as a SELECTOR:
   *   - it may start with a digit ("2024 Roadmap" -> "2024-roadmap"), and
   *     `#2024-roadmap` is not a valid selector at all - querySelector THROWS.
   *   - the fallback id for a heading whose text slugifies to nothing is
   *     'sec-' + the dotted number, e.g. "sec-1.2.1", where the dots read as
   *     class selectors and quietly match nothing.
   * Reached through `window.CSS` rather than the bare global so the shim is the
   * same one app/js/reader.js uses, and so no extra global is assumed.
   * @param {string} id
   * @returns {string}
   */
  function cssEscape(id) {
    return (window.CSS && window.CSS.escape) ? window.CSS.escape(id) : id.replace(/([^\w-])/g, '\\$1');
  }
</script>

<ol>
  {#each entries as entry (entry.id)}
    <li class="lvl-{entry.level}"><a href="#{entry.id}" data-target={entry.id} onclick={ev => jump(ev, entry)}><span class="n">{entry.number}</span>{entry.text}</a></li>
  {/each}
</ol>
