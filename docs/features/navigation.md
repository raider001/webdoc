<!--meta
{ "title": "Navigation", "description": "The document tree, the on-this-page contents with automatic numbering, and headings that in-body links can anchor to.", "assumes": ["Docs/overview"], "next": ["Docs/features/search"] }
-->

# Navigation

WebDocs gives a reader three complementary ways to move through a document set,
each answering a different question. The document **tree** answers "which
documents exist?". The on-this-page **contents** answers "what is in *this*
document?". The **map** answers "how do these documents relate?". They are
designed to be used together.

## Three surfaces

### The document tree — moving between documents

The hamburger control opens a drawer containing the whole library as a
collapsible folder tree, built directly from the source folders on disk. A
source such as `docs/` mounted as `Docs` becomes the top of the tree; nested
folders like `requirements/functional` become nested branches. Selecting a leaf
loads that document into the content pane. The tree is the primary way to browse
the set from end to end.

### The contents — moving within a document

Within a document, the contents pane lists every heading in order. This list is
generated from the same headings the renderer numbered, so it always matches the
page exactly. Clicking an entry scrolls to that section; as you read, the current
section stays reflected in the list. Because it is derived from the document
itself, there is nothing to keep in sync by hand.

### The map — moving spatially

For a bird's-eye view, [the map](Docs/features/map) draws the documents as a
graph and lets you pan, zoom and jump between related pages. It is the spatial
counterpart to the linear tree.

## Automatic heading numbers

Every heading is numbered hierarchically at render time — `1`, `1.1`, `1.2`,
`1.2.1` — following the heading levels you wrote. You never type a number into a
heading; the engine assigns them, and the exact same numbers appear in the
contents pane. This keeps a long document's structure legible and makes the
contents list a faithful, clickable outline.

Two consequences worth knowing when authoring:

- Skipping a level (jumping `#` straight to `###`) will produce surprising
  numbers, so keep heading levels contiguous.
- Renaming or reordering sections needs no renumbering work — save the file and
  the numbers recompute.

## Breadcrumbs and location

A document's position in the tree is shown as a breadcrumb trail, so a deeply
nested page such as `Docs/requirements/functional/navigation` still tells you
where you are at a glance. The breadcrumb mirrors the folder path that produced
the document id.

## Deep links

Every document is addressable. The reader uses hash routing, so the current
document is encoded in the URL as `#/<docId>` — for example
`#/Docs/features/navigation` opens this page directly. That makes any document
shareable: copy the address bar and the recipient opens the same page — always
scrolled to the top, because loading a document resets the scroll position. The
route encodes only the document (optionally with a `?req=`/`?test=` query), never
a heading or where you had scrolled, so there is no URL that lands on a specific
section.

Headings still receive anchor ids, so an authored in-body link can point at one —
for example `[text](Docs/features/map#some-heading)` jumps to that heading when
clicked. That is an authoring convenience, not a shareable route position.

Deep linking is what ties the three surfaces together: a search result, a map
node, and a tree entry all ultimately resolve to the same `#/<docId>` route.
When you are ready to find documents by content rather than browse for them,
continue to [search](Docs/features/search).
