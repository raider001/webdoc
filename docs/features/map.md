<!--meta
{ "title": "The Map View", "description": "A pannable, zoomable graph of how documents and requirements relate.", "assumes": ["Docs/overview"], "next": ["Docs/features/access-control"] }
-->

# The Map View

The map is a bird's-eye graph of the whole documentation set. Where the tree
lists documents and the contents lists headings, the map shows *relationships* —
what depends on what, what to read next, which requirements trace across
documents, and where the prose links out. It is a hand-rolled SVG graph with a
layered layout, drawn entirely in the browser with no charting library.

## Nodes are documents

Each document is a node. Their positions come from a layered layout that flows
from prerequisites toward the documents that build on them, so reading order
tends to run in a consistent direction across the canvas. Every *existing*
document node is clickable, and the currently open document is highlighted so
you always know where you stand. Documents that are referenced but not present
in the set are drawn as non-interactive "missing" placeholders — you cannot
select or focus them — and an outside-URL target renders as a box that opens in
a new tab (see below) rather than a selectable document.

## Four kinds of edge

The edges are computed from document metadata and body content, and each kind is
drawn distinctly so you can read the graph at a glance:

- **Prerequisite** — drawn from a document's `assumes` list. "Read this first."
- **Recommended-next** — drawn from a document's `next` list. "Read this after."
- **Requirement-trace** — a document-to-document edge derived from requirement
  `trace-to` links, connecting the documents whose requirements reference one
  another. See [requirements traceability](Docs/features/requirements) for how
  those links are authored.
- **Page-link** — an in-body `[text](target)` link that is *not* already shown by
  one of the edges above. This is why ordinary cross-references in prose show up
  on the map: the link in the previous bullet, for instance, becomes a page-link
  edge because it is neither an `assumes` nor a `next` relationship.

Each category has a **legend toggle**, so you can show or hide prerequisite,
recommended-next, requirement-trace or page-link edges independently to
declutter the view and focus on one kind of relationship at a time.

## External links become boxes

Not every link points at another document. When the prose links to an outside
URL — say, [the CommonMark spec](https://spec.commonmark.org/0.31.2/) that the
parser conforms to — the map renders the target as a distinct URL box carrying a
small "?" bubble that marks the destination as external. Activating the box
**opens the URL in a new tab**, leaving the map and your place in the docs
untouched. This lets the graph represent the
document set's outbound references without pretending an external site is one of
your own pages.

## Interacting with the canvas

The map is meant to be roamed:

- **Pan** by dragging the background.
- **Zoom** with the mouse wheel toward the cursor.
- **Fit** to recentre and frame the whole graph.
- **Node search** to locate and centre a node by name in a large set; a match
  is centred and flashed, and the other nodes stay put (it does not filter or
  hide them).
- **Minimap** for orientation while you are zoomed in on one region.

## Select and stay

Clicking a node **selects** it without navigating away — the map stays open so
you can keep exploring, and the selected document is the one that opens when you
leave the map and return to reading. When you want to jump straight in,
**double-click** a node to open that document immediately. This "select-and-stay,
double-click-to-open" model lets you plan a path across the graph before
committing to it.

Taken together, the map turns a folder of Markdown into a navigable web of
prerequisites, reading order, requirement traces and cross-references — the same
relationships every other surface uses, made visible in one place.
