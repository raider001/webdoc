<!--
  "Export report" - top-right of the coverage overlay.

  A BUTTON AND NOTHING ELSE, deliberately. The work it triggers stays in
  app/js/coverage-view.js's exportReport(): that function assembles the report
  input, calls the frozen app/js/report.js to build a self-contained HTML file
  and hands it to app-shell.js's downloadFile(). None of that may move into the
  bundle - report.js writes a document that has to open from a file:// URL on
  someone else's machine, with no bundler runtime anywhere near it.

  The title text is asserted verbatim by tests/test_coverage_ui.py, which pins
  the affordance's explanation rather than clicking it (a test whose side effect
  is a file on disk fails differently on a different machine).
-->
<script>
  /** @type {{ onExport: () => void }} */
  let { onExport } = $props();
</script>

<button
  class="cov-export-btn"
  type="button"
  title="Download a self-contained test report (HTML) you can share anywhere"
  onclick={onExport}
>⤓ Export report</button>
