<!--meta
{ "title": "Check Test Coverage", "description": "See which requirements are verified, read a requirement's report, and record manual test runs.", "assumes": ["Docs/how-to/requirements"], "next": ["Docs/how-to/theming"] }
-->

# Check Test Coverage

The coverage view is a full-screen picture of which requirements are verified.
Open it with the ✓ button in the header, titled "Test coverage"; the button
toggles it, and Escape closes it — closing the report panel first if that panel
is open. Like the map, it is mutually exclusive with the map view.

The view is a colour-coded graph of requirement nodes with their test cases
hanging off them. Each node is coloured by its rolled-up status:

- pass — green
- fail — red
- partial — yellow
- untested — blue

![The coverage graph zoomed to a cluster of requirement nodes, each showing its passing percentage — one requirement is red for failing.](/assets/how-to/coverage.png)

A requirement's caption reads "<n>% passing", or "untested" when it has no
evidence yet; a test's caption is Pass, Fail, Partial, or Untested. The legend
— Passing, Failing, Partial, Untested — filters the graph by status, hiding all
nodes of a status and any edge that touches them. Two toolbar buttons sit on the
overlay: "▷ Run tests" opens the runner for every test case, and "⤓ Export
report" downloads a self-contained HTML report you can share.

## Open a requirement's report

Click any node to open its report panel on the right. A requirement's panel
shows its description, an "Open in its document ↗" link, an "Automated results"
section with one row per recorded result, and a "Test cases" list — its computed
Verified By tests, each clickable through to its own report. A search box at the
foot of that list lets you link an existing test case to the requirement.

## Record manual tests

Manual evidence is recorded through the runner, reached from "▷ Run tests" (all
tests) or "▷ Run this test" on a test-case report. The runner is a checklist
grid: for each test you fill an "Actual response" against each expected step and
toggle the step ✓ (pass) or ✗ (fail) — an untouched step is not recorded. Enter
your name in the "Tester" field and click "Save run"; only the tests you touched
are written, and the graph and page recolour. Manual results are stored per
source in a hidden sidecar file, keyed by test or requirement id. See [the test
coverage view](Docs/features/test-coverage) for how the statuses roll up.
