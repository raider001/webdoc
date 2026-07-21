<!--meta
{ "title": "Development Roadmap", "description": "The stages in which WebDocs features were released, and what became available in each.", "assumes": ["Docs/overview"], "next": [] }
-->

# Development Roadmap

WebDocs was built in seven stages, each adding a self-contained capability on top
of the one before. This is not a dated timeline — it is a record of the *stages*
in which features became available, so you can tell which layer any given
behaviour belongs to. Every stage held to the same rule: zero third-party
runtime dependencies.

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

## Stage 6 — Search

Finding a document without knowing where it lives.

- All-document search by title.
- All-document search by heading.

## Stage 7 — Enhancements & polish

The refinements that made the map and layout comfortable to live in.

- Legend show/hide toggles per edge category.
- Node select-and-stay (single-click selects without closing the map).
- Requirement-trace edges on the map.
- Page-link edges, with external links shown as boxes that open in a new tab.
- A wider content column.

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
| Legend show/hide toggles | 7 |
| Node select-and-stay | 7 |
| Requirement-trace edges | 7 |
| Page-link edges + external-link boxes | 7 |
| Wider content column | 7 |
