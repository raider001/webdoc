<!--meta
{ "title": "Development Roadmap", "description": "The stages in which WebDocs features were released, and what became available in each.", "assumes": ["Docs/overview"], "next": [] }
-->

# Development Roadmap

WebDocs was built in ten stages, each adding a self-contained capability on top
of the one before. This is not a dated timeline — it is a record of the *stages*
in which features became available, so you can tell which layer any given
behaviour belongs to. Every stage held to the same rule: zero third-party
runtime dependencies — the sole exception being the optional, bring-your-own
diagram library introduced in the final stage.

## Stage 1 — Foundation

The application shell and everything needed to read a single document.

- App shell: header, two-pane layout (contents beside content), and footer.
- Day/night theming resolved before first paint.
- The HTML sanitizer (allowlist pass over the rendered DOM).
- Heading auto-numbering and the on-this-page contents list.
- Config-driven document discovery.
- The hamburger document tree for moving between documents.
- Hash routing and deep links.
- The multi-link footer.

## Stage 2 — Rendering engine

A real Markdown engine, written from scratch.

- A two-phase CommonMark 0.31.2 parser (block-structure phase, then inline
  phase).
- GFM extensions: tables, task lists, strikethrough, and autolinks.
- 99.5% conformance against the official CommonMark specification suite.

## Stage 3 — Syntax highlighting

Per-language tokenizers, no highlighting library.

- Python.
- Robot Framework.
- Makefile.
- Shell.
- Java.

## Stage 4 — The map

A spatial view of the document set.

- Layered graph layout.
- Cursor pan and zoom.
- Node search.
- Minimap.
- Legend.
- Prerequisite and recommended-next edges.

## Stage 5 — Requirements traceability

Requirements as first-class, linkable content.

- Requirement-group tables.
- Ids composed from configured components.
- Authored `trace-to` links plus a calculated `trace-from`.
- A five-column rendered table — Requirement, Description, Trace To, Trace From,
  Verified By — where `Verified By` is calculated from the test cases whose
  `verifies` reference the requirement.

## Stage 6 — Search

Finding a document without knowing where it lives — and finding text within one.

- In-document *Find in page* (highlights matches and scrolls to the first).
- All-document search by title.
- All-document search by heading.

## Stage 7 — Enhancements & polish

The refinements that made the map and layout comfortable to live in.

- Legend show/hide toggles per edge category.
- Node select-and-stay (single-click selects without closing the map).
- Requirement-trace edges on the map.
- Page-link edges, with external links shown as boxes that open in a new tab.
- A wider content column.

## Stage 8 — Test coverage

Turning requirements into something you can actually verify.

- Test-case authoring: named test cases, each with a `T_` id, a `Verifies:`
  line, and a numbered action / expected-response step table.
- Requirement verification: a test case's `verifies` feeds the calculated
  `Verified By` column on the requirement table.
- The coverage view (checkmark button): a full-screen graph of requirement and
  test-case nodes coloured by status — pass, fail, partial, or untested.
- Run tests: a checklist runner recording an actual response and pass/fail per
  step, notes, and run metadata, rolling the steps up into a per-test status.
- Export report: a self-contained HTML coverage report.

## Stage 9 — In-app authoring

Editing documents without leaving the reader.

- A hand-written, zero-dependency WYSIWYG block editor (the floating Edit button
  edits the current document).
- New-document creation (the `+` button).
- Save via `PUT` back to the document source.
- Requirement-group and test-case authoring widgets (the test widget offers a
  key, a name, a Verifies picker, and action / expected step rows).

## Stage 10 — Diagrams & renderer plugins

The one place the core opens the door to an outside library.

- A renderer-plugin registry, run as a post-sanitize pipeline stage.
- Mermaid diagram rendering: fenced `mermaid` blocks become pan/zoom diagrams.
- This is the optional, bring-your-own-library exception to the otherwise
  zero-third-party-runtime core — the diagram library is loaded only if present,
  and the block falls back to its source code if it is absent.

## Feature summary

| Feature | Stage |
| ------- | ----- |
| App shell (header, two-pane, footer) | 1 |
| Day/night theming | 1 |
| HTML sanitizer | 1 |
| Heading auto-numbering + contents | 1 |
| Config-driven document discovery | 1 |
| Hamburger document tree | 1 |
| Hash routing + deep-links | 1 |
| Multi-link footer | 1 |
| CommonMark 0.31.2 parser (two-phase) | 2 |
| GFM tables, task lists, strikethrough, autolinks | 2 |
| 99.5% spec conformance | 2 |
| Python highlighting | 3 |
| Robot Framework highlighting | 3 |
| Makefile highlighting | 3 |
| Shell highlighting | 3 |
| Java highlighting | 3 |
| Map: layered layout | 4 |
| Map: cursor pan/zoom | 4 |
| Map: node search | 4 |
| Map: minimap | 4 |
| Map: legend | 4 |
| Map: prerequisite + recommended-next edges | 4 |
| Requirement-group tables | 5 |
| Requirement ids from components | 5 |
| Trace-to + calculated trace-from | 5 |
| Search by title | 6 |
| Search by heading | 6 |
| In-document find in page | 6 |
| Legend show/hide toggles | 7 |
| Node select-and-stay | 7 |
| Requirement-trace edges | 7 |
| Page-link edges + external-link boxes | 7 |
| Wider content column | 7 |
| Test-case authoring | 8 |
| Coverage view + run tests + status rollup | 8 |
| HTML report export | 8 |
| WYSIWYG editor + new-doc + PUT save | 9 |
| Requirement/test-case editor widgets | 9 |
| Renderer plugins + Mermaid diagrams | 10 |
