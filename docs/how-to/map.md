<!--meta
{ "title": "Explore the Map", "description": "Read the graph of how documents and requirements relate — pan, zoom, toggle categories, select and open.", "assumes": ["Docs/how-to/searching"], "next": ["Docs/how-to/authoring"] }
-->

# Explore the Map

The map is a full-screen picture of how your documents relate. Open it with the
map button in the header — the ◱ icon, titled "Map" — and the same button or the
Escape key closes it. The map and the test-coverage view are mutually exclusive:
opening one closes the other.

![The map view: document nodes joined by coloured edges, with the legend of toggles, a search box, a minimap, and zoom controls.](/assets/how-to/map.png)

Single-click and double-click do different things:

- Single-click a document node to select it and stay on the map. The map keeps
  its place so you can carry on exploring, and the selected document is the one
  you land on when you leave.
- Double-click a node to open that document and close the map.

Enter or Space on a focused node selects it, the same as a single click.

Pan by dragging the background; zoom with the mouse wheel toward the cursor, or
with the +, −, and ⤢ (fit to view) buttons on the canvas. The minimap in the
corner shows the whole graph and your current viewport — click it to recentre.
The "Find a document…" box locates a node by title or id, centres it, and
flashes it, but does not select it.

The legend down the side is a set of toggles — click one to hide or show that
kind of edge or node without moving anything else:

- Prerequisite — "read this first" edges from a document's `assumes` list.
- Recommended next — "read this after" edges from a document's `next` list.
- Requirement trace — requirement traces, collapsed to document-to-document
  edges (shown only when such edges exist).
- Page link — plain in-body links from one document to another (shown only when
  such links exist).
- Missing — placeholder nodes for ids that are referenced but not real
  documents.

An ordinary in-body link to another document becomes a page-link edge. A link to
an outside URL becomes a URL box with a small "?" bubble in its corner; click it
to open that address in a new tab, leaving the map and your place untouched.
[The Map View](Docs/features/map) covers the full model.
