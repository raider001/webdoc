<!--meta
{ "title": "Test Coverage", "description": "Author test cases that verify requirements, record results in the runner or from automated xUnit, and roll a pass/fail/partial/untested status up the trace tree.", "assumes": ["Docs/features/requirements"], "next": ["Docs/reference/config"] }
-->

# Test Coverage

WebDocs is a lightweight test tool as well as a requirements tool. You author
**test cases** — small action / expected-response tables that each declare the
requirements they *verify* — then record results by hand in a **runner**, or feed
them in from an **automated** xUnit / JUnit file your CI already produces. WebDocs
merges the two, computes a **pass / fail / partial / untested** status for every
test case and every requirement, and rolls each requirement's status up over its
whole trace tree. A requirement is only as green as the tests that verify it and
the requirements that trace to it.

This page assumes you have read [Requirements Traceability](Docs/features/requirements),
which explains the requirement tables and the trace tree that coverage is drawn
over.

## Two id namespaces: `R_` and `T_`

Every id in the system is component-scoped and carries a one-letter kind prefix, so
requirements and tests never collide:

- A **requirement** id is `R_{COMPONENT}_{GROUP}_{NO}`, upper-cased whole — row 1
  of the `nav` group in the `WD` component is `R_WD_NAV_1`.
- A **test** id is `T_{COMPONENT}_{key}`, and it **keeps the key's case** — a test
  keyed `nav-tree` becomes `T_WD_nav-tree`.

When you reference a requirement from **another requirement's `trace-to`**, the
group context is known, so you can write the short form — `nav_1`, `NAV_1`, or a
bare `1` inside the same group — and it resolves **case-insensitively** to the
composed upper-cased id. A test's `verifies`, however, is resolved **without**
group context: from a test you must use the full id or the `group_no` / `NAV_1`
form (e.g. `nav_1` or `R_WD_NAV_1`). A bare number like `1` will **not** resolve
from a test and silently breaks the Verified By link. The component always comes
from the source's `component` in [`config.json`](Docs/reference/config).

## Test cases

A test case is its own metadata-wrapped Markdown table, exactly like a requirement
group but with a different meta header. The header names the test and lists what it
verifies; each body row is one **step** — an action and its expected response:

```text
<!--meta start {"test":"nav-tree","name":"Document tree renders","verifies":["nav_1","nav_2"]}-->
| action                                     | expected response                                     |
| ------------------------------------------ | ----------------------------------------------------- |
| Load the site with two or more documents.  | The left drawer shows a folder tree of every document.|
| Click a folder row.                        | The folder expands to reveal its documents.           |
<!--meta end {"test":"nav-tree"}-->
```

The header fields:

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `test` | string | The test **key**. Composed with the component into the id — `nav-tree` here yields `T_WD_nav-tree`. Case is preserved. |
| `name` | string | A human title for the test, shown in every surface. Falls back to the key. |
| `verifies` | string[] | The requirement references this test exercises. Short refs (`nav_1`) resolve case-insensitively; a test may verify many requirements. |

On render this becomes a captioned figure: the name and `T_` id, a **result badge**,
a **Verifies:** line linking each requirement, and the numbered **# / Action /
Expected response** step table. A **▷ Run** button on the caption launches the
runner for just that test.

### Verifies is authored; Verified By is calculated

Tracing runs **from the test**. You author `verifies` on the test case, and WebDocs
inverts it: each requirement's **Verified By** column is the calculated set of
every test whose `verifies` resolves to that requirement. So the `verifies` above
makes `T_WD_nav-tree` appear in the Verified By column of both `R_WD_NAV_1` and
`R_WD_NAV_2`, without you touching those requirement tables. One test can verify
many requirements, and one requirement can be verified by many tests.

## Authoring a test case

Author test cases in the WYSIWYG editor with the **Test case** block, or by hand in
Markdown using the `meta start` / `meta end` pair shown above.

In the editor, insert a **Test case** block and fill in:

- a **Test key** — the preview shows the composed `T_{component}_{key}` id live as
  you type;
- a **Name**;
- a **Verifies** picker — the same chip-and-autocomplete reference field a
  requirement's Trace-To uses, so you pick requirements by id and description;
- one or more **Action / Expected response** rows, with **+ Step** to add more.

Saving writes the block back out as the metadata-wrapped table, so hand-authored
and editor-authored test cases are the same thing on disk.

## Opening the coverage view

The **✓** button in the header opens the coverage view: a full-screen graph that
shows **both** requirement nodes and test-case nodes, each coloured by status —
**green** passing, **red** failing, **yellow** partial, **blue** untested. Test
nodes hang off the requirements they verify. A **legend** keys the colours, and
each legend entry is a toggle that hides nodes of that status (and any edge that
touches a hidden node). Click any node to open its **report panel** on the right;
clicking a **test** node shows that test's definition, its recorded actual
responses and pass/fail marks, and run metadata. The view also carries a **▷ Run
tests** button and a **⤓ Export report** button, covered below.

## Recording results — the runner

**▷ Run tests** (from the coverage view, or **▷ Run** on any single test-case
block) opens the runner: a full-screen **checklist grid**. Every test case shows
its whole action / expected table at once, and for each step the tester records:

- an **Actual response** — a rich-text field for what actually happened;
- a **Pass / Fail** toggle (✓ / ✗) per step; leaving it unset means *not recorded*;
- free-form **Notes** for the run.

A **Tester** name in the top bar persists in `localStorage`, and a live progress
line counts steps recorded, passed and failed. Pressing **Save run** stores the
**latest result per test** into that test's source sidecar, stamped with run
metadata (`at` timestamp + `by` tester). Only tests you actually touched are
rewritten; untouched tests keep their existing result, and a test whose steps were
all cleared is removed. Unmarked steps are kept in the stored array with
`pass: null` so it stays index-aligned with the definition when the runner is
re-opened — a re-run starts exactly where the last one left off.

A recorded run is stored per test id like this:

```json
{
  "T_WD_nav-tree": {
    "run": { "at": "2026-07-22T09:15:00.000Z", "by": "Dani" },
    "steps": [
      { "step": "Load the site with two or more documents.", "response": "Tree listed all six documents.", "pass": true },
      { "step": "Click a folder row.", "response": "Folder expanded.", "pass": true }
    ],
    "report": "No issues."
  }
}
```

The requirement report panel shows the requirement's **automated results** and a
clickable list of its **verifying test cases**, plus a **Search to link an existing
test…** box that links an existing test to the requirement (adding the requirement
to that test's `verifies`). Manual and run evidence is recorded through the
**runner** against test cases, not authored inline against a requirement. The
rollup still combines any results stored against a requirement id with the results
of its verifying tests, but there is no inline editor to author the former.

## Automated results

Automated results come from an xUnit / JUnit XML file, configured **per source** by
the `testResults` field on that source in [`config.json`](Docs/reference/config).
A relative value is served from the source mount at `/docs/<name>/<path>`; an
absolute URL or root-relative path passes straight through. The demo source

```json
{ "name": "Docs", "path": "docs", "component": "WD", "testResults": ".results.xml" }
```

resolves to `/docs/Docs/.results.xml`. A top-level `testResults` may be set as a
**fallback** for sources that do not define their own, but it is still resolved
**per source** — a source uses its own `testResults` if present, else the top-level
one — so it never surfaces as a global results URL in `/site.json`. Automated
results are always attached to the source whose component owns the ids.

`parseXUnit` (`app/js/coverage.js`) walks every `<testcase>`. A `<failure>` or
`<error>` child marks the case failed and captures its `message` attribute (or its
text, first 240 characters); anything else is a pass. It then links the case to one
or more ids by **all three** of these rules — they are not exclusive, and the id a
rule yields may be **either** a requirement (`R_…`) **or** a test (`T_…`):

1. **An explicit `requirement` property.** Every child
   `<property name="requirement" value="ID"/>` contributes its trimmed value. This
   is the clearest form and is not tied to your test names. (The property name is
   literally `requirement`, but the value may just as well be a test id.)
2. **The `classname` being an id.** If `classname` matches `/^[A-Za-z]\w*_\w+/` —
   it looks like a composed id — the whole classname is taken as an id.
3. **A composed id anywhere in the name or classname.** Every
   `/\b([A-Za-z]\w*_\w+_\w+)\b/g` token (a three-or-more-segment id) appearing in
   the `name` or `classname` is linked.

So each of these attaches to the intended id:

```xml
<!-- rule 1: explicit property, here naming a TEST id -->
<testcase name="valid login redirects" classname="auth.login">
  <properties><property name="requirement" value="T_WD_login-valid"/></properties>
</testcase>

<!-- rule 2: classname is the requirement id -->
<testcase classname="R_WD_NAV_1" name="tree renders"/>

<!-- rule 3: a composed id sits in the name; the failure marks it red -->
<testcase name="R_WD_SAFE_3 rejects javascript: URLs">
  <failure message="a javascript: URL survived">assert neutralised == true</failure>
</testcase>
```

Every id any rule yields records a `{ name, pass, message }` entry against that id,
so a single `<testcase>` can count toward several ids at once.

## Where results are stored

Manual and run results live **per source** in a hidden **`.webdoc-tests.json`**
sidecar inside that source's folder (for the `Docs` source, `docs/.webdoc-tests.json`),
keyed by requirement or test id. WebDocs reads it with `GET /api/tests/<source>`
and writes it with `PUT /api/tests/<source>`; on save the flat in-memory map is
split back into per-source buckets by each id's component prefix, so every source's
sidecar is rewritten and deletions persist. Both `.webdoc-tests.json` and the
automated `.results.xml` are dotfiles, omitted from directory listings so they
never surface as documents.

There is no project-root results file and no `/api/manual-tests` endpoint — results
are entirely per-source.

## How status rolls up

A **test case's** status is just its own recorded results, with no rollup: any
recorded fail makes it **fail**, no recorded result makes it **untested**,
otherwise **pass**.

A **requirement's** status is richer. Its **own evidence** is any results recorded
directly against its id **plus** the results of every test that verifies it — so a
requirement with no direct results is still covered when its linked test cases
pass. That evidence is then rolled up over the requirement's **subtree**: the
requirement itself plus everything that traces to it (its **Trace-From** set),
followed transitively.

Within the subtree, a **leaf** is a requirement nothing traces to. A **unit** is
every leaf, plus any non-leaf that carries its own tests (e.g. an integration
test). The rolled-up status is:

- **fail** — at least one result in the subtree failed.
- **untested** — nothing in the subtree has any recorded result.
- **pass** — every leaf has been tested and none failed (or, for a requirement that
  is itself a leaf, its own evidence passes).
- **partial** — anything in between: some units tested, none failing.

The percentage on a node is **passing units out of all units**. A passing node is
exactly **100**; a fail or partial node is capped at **99**, so a red node can
never round up to a green-looking 100, and an untested leaf beneath a node always
holds it under 100. A wholly untested node shows **no** percentage.

## The map and the shareable report

The coverage graph is the map view of testing: requirement nodes and test-case
nodes, each coloured by rolled-up status, with the status legend doubling as a
per-status filter. Clicking a test node opens its report — definition, recorded
actuals, and run metadata — and a link to open the test in its own document.

**⤓ Export report** downloads a **self-contained, shareable HTML file** — inline
CSS, no scripts, no server, nothing external — that you can open or email anywhere.
It contains:

- a **summary** with the percentage of requirements verified and the count of test
  cases passing, each with a status bar;
- a **requirements** table (id, description, status, %, Verified By);
- a **test-case** table (id, name, steps, result, **Last run**, Verifies);
- an **evidence appendix** for every test that has recorded results — its automated
  and manual outcomes, actual responses, failure messages and run metadata.

All embedded text is HTML-escaped, so authored content can never inject markup into
the report.

## Where to go next

- [Requirements Traceability](Docs/features/requirements) explains the trace tree
  the rollup walks — the Trace-From set each requirement's status is rolled up over.
- [The Authoring Reference](Docs/reference/authoring) covers the metadata and table
  syntax that requirement groups and test cases share.
- [The configuration reference](Docs/reference/config) documents each source's
  `component` and `testResults`, and the rest of `config.json`.
