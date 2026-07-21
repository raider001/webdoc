<!--meta
{ "title": "WebDocs Overview", "description": "What WebDocs is: a zero-dependency reader that turns Markdown into a browsable, traceable documentation site.", "assumes": [], "next": ["Docs/design/architecture", "Docs/features/markdown"] }
-->

# WebDocs Overview

WebDocs is a documentation reader with a deliberately small footprint: a folder
of Markdown files, a tiny Python standard-library server, and a single-page
browser application that does all of the real work. Point it at a directory of
`.md` files and it becomes a navigable, cross-linked, traceable documentation
site — no build step, no bundler, and nothing to install beyond a Python
interpreter you almost certainly already have.

This document set *is* WebDocs documenting itself. Everything you read here was
authored as Markdown, discovered from `config.json`, parsed and rendered in your
browser by the same engine it describes.

## The philosophy

Four principles shape every part of the tool.

- **Zero third-party runtime dependencies.** There is no framework, no Markdown
  library, no syntax-highlighter package, and no CSS toolkit. The parser, the
  sanitizer, the highlighters, the map, and the theming layer are all
  hand-written vanilla JavaScript. The only development dependency is Playwright
  (Python), used to run the test suite.
- **Effectively static.** Documents are plain files. The optional server exists
  only to enumerate them and hand them to the browser; it renders nothing. The
  same content can be served by any static host.
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
  extensions turns Markdown into HTML. See [Markdown & GFM](Docs/features/markdown).
- **Navigation** — a hamburger document tree between documents, an on-this-page
  contents list within a document, and hash-routed deep links. See
  [Navigation](Docs/features/navigation).
- **The map** — a hand-rolled SVG graph of how documents and requirements relate,
  with pan, zoom, search, and a minimap. See [The Map View](Docs/features/map).
- **Requirements** — metadata-wrapped tables that compose stable requirement ids
  and trace to and from one another across documents. See
  [Requirements Traceability](Docs/features/requirements).
- **Search** — an all-documents search over titles and headings, from the drawer.
  See [Search](Docs/features/search).
- **Theming** — day and night themes built on CSS custom-property design tokens,
  resolved before the first paint. See [Theming](Docs/design/theming).

## How a document becomes a page

Each document runs through a fixed pipeline: requirement groups are extracted,
the Markdown is parsed, the result is sanitized against an allowlist, headings
are numbered and a table of contents is built, tables and code are decorated,
and the finished fragment is injected into the page. The
[Architecture](Docs/design/architecture) document walks through every stage, and
[The CommonMark Engine](Docs/design/parser) covers the parser at its heart.

## Where to go next

If you want to know *what shipped when*, [the roadmap](Docs/roadmap) lays out the
seven stages in which these capabilities were built. Otherwise, the
[Architecture](Docs/design/architecture) is the natural next read, followed by
the [Markdown & GFM](Docs/features/markdown) showcase that exercises the renderer
in place.
