<!--meta
{
  "title": "WebDocs Overview",
  "description": "What WebDocs is: a zero-dependency reader that turns Markdown into a browsable, traceable documentation site.",
  "assumes": [],
  "next": [
    "Docs/design/architecture",
    "Docs/features/markdown",
    "Docs/roadmap",
    "Docs/tests/navigation"
  ]
}
-->

# WebDocs Overview

WebDocs is a documentation reader with a deliberately small footprint: a folder
of Markdown files, a tiny Python standard-library server, and a single-page
browser application that does all of the real work. Point it at a directory of
`.md` files and it becomes a navigable, cross-linked, traceable documentation
site — nothing to install beyond a Python interpreter you almost certainly
already have. The browser application is compiled, but its bundle is committed
to the repository, so a clean clone needs no toolchain and no network: `python
serve.py` and you are reading.

This document set *is* WebDocs documenting itself. Everything you read here was
authored as Markdown, discovered by the browser from the server's `/site.json`
manifest (generated from `config.json`, which lists content sources rather than
individual documents) and the per-source JSON directory listings it walks, then
parsed and rendered in your browser by the same engine it describes.

## The philosophy

Four principles shape every part of the tool.

- **One third-party runtime dependency, and no more.** The browser ships a
compiled Svelte 5 runtime, which the interactive chrome was moved onto once
hand-wiring DOM updates across a growing number of views had become the largest
single source of the reader's state bugs. Nothing arrived with it: there is
still no Markdown library, no syntax-highlighter package, no CSS toolkit and no
diagram engine in the core, and the parser, the sanitizer, the highlighters, the
map, the WYSIWYG editor and the theming layer are all still hand-written. The
server keeps the original rule outright — `serve.py` is Python standard library
only — and every npm package in the repository is build-time development
tooling, so the manifest's runtime `dependencies` object is empty. Playwright
(Python) is the other development dependency, used to run the test suite.
- **Effectively static.** Documents are plain files. The optional server exists
only to enumerate them and hand them to the browser; it renders nothing. The
Markdown files themselves are static, but the reader relies on the bundled
server for the `/site.json` manifest and the per-source JSON directory listings
(and for the `PUT` requests behind in-app editing and saved test results), so a
plain static host would need those listings pre-generated and still could not
support editing.
- **Everything renders in the browser.** A document travels from raw Markdown to
sanitized, numbered, highlighted HTML entirely on the client. The server never
transforms content.
- **Self-documenting.** Because the tool reads a folder of Markdown, the most
honest way to document it is to author that documentation *as* WebDocs
content — which is exactly what this site is.

## The pillars

WebDocs is best understood as a handful of independent capabilities layered over
a shared rendering pipeline.

- **Rendering** — a from-scratch CommonMark 0.31.2 parser plus GitHub-flavored
extensions turns Markdown into HTML, with a renderer-plugin stage that turns
fenced blocks into diagrams (the default checkout ships mermaid enabled). See
[Markdown & GFM](Docs/features/markdown) and [Diagrams](Docs/features/diagrams).
- **Navigation** — a hamburger document tree between documents, an on-this-page
contents list within a document, and hash-routed deep links. See
[Navigation](Docs/features/navigation).
- **The map** — a hand-rolled canvas graph of how documents and requirements
relate, with pan, zoom, search, and a minimap. See [The Map View](Docs/features/map).
- **Requirements** — metadata-wrapped tables that compose stable requirement ids
and trace to and from one another across documents. See
[Requirements Traceability](Docs/features/requirements).
- **Test coverage** — author test cases that verify requirements, run them
in-browser against a checklist runner, and export a standalone coverage report.
See [Test Coverage](Docs/features/test-coverage).
- **Authoring** — a zero-dependency WYSIWYG block editor, opened from a
new-document modal or the in-page edit button, that normalises back to Markdown
and saves it to the server. See [Authoring](Docs/reference/authoring).
- **Search** — an all-documents search over titles and headings, from the drawer.
See [Search](Docs/features/search).
- **Access control** — optional accounts and access groups, with per-document
read and modify rules that flow recursively down the Recommended-next chain, and
restrictions on individual sections. Off by default; on a server without it
nothing changes. See [Accounts & Access
Control](Docs/features/access-control).
- **Theming** — light and dark themes built on CSS custom-property design tokens,
resolved before the first paint. See [Theming](Docs/design/theming).
- **Scale** — a standard-library SQLite index on the server and a culled canvas
renderer let the same reader stay fast from a handful of documents to tens of
thousands (measured to half a million). See
[Performance & Scale](Docs/reference/performance).

## How a document becomes a page

Each document runs through a fixed pipeline: requirement groups are extracted,
the Markdown is parsed, the result is sanitized against an allowlist, headings
are numbered and a table of contents is built, tables and code are decorated,
and the finished fragment is injected into the page. The
[Architecture](Docs/design/architecture) document walks through every stage, and
[The CommonMark Engine](Docs/design/parser) covers the parser at its heart.

## Where to go next

If you just want to *use* WebDocs — read the set, search it, author and link
documents, add diagrams, trace requirements, check coverage — the
[How-To Guide](Docs/how-to) is the practical starting point: a recipe per job.
If you want to know *what shipped when*, [the roadmap](Docs/roadmap) lays out the
twelve stages in which these capabilities were built. Otherwise, the
[Architecture](Docs/design/architecture) is the natural next read, followed by
the [Markdown & GFM](Docs/features/markdown) showcase that exercises the renderer
in place.
