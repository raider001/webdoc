<!--meta
{ "title": "Read and Navigate", "description": "Move around the set with the document tree, the contents pane, breadcrumbs, and deep links.", "assumes": ["Docs/how-to/running"], "next": ["Docs/how-to/searching"] }
-->

# Read and Navigate

WebDocs gives you four ways to move around: the document tree, the contents
pane, the breadcrumb trail, and deep links.
[Navigation](Docs/features/navigation) describes each in depth; the recipes here
are the short version.

## Move between documents

Open the tree drawer with the hamburger button — the menu icon at the far left
of the header, labelled "Open document navigation". The drawer lists every
document as a folder tree derived from the document ids: source folders sit at
the top and open by default, sub-folders start collapsed. Click a document
title to go there, and the drawer closes behind you; Ctrl-, Cmd-, or
Shift-click opens it in a new tab instead. The document you are reading is
marked as the current page and scrolled into view, so re-opening the drawer
always shows where you are. Close the drawer with its ✕ button, by clicking the
dimmed backdrop, or by pressing Escape.

![The document tree drawer open over the reading pane, with source folders and the current document highlighted.](/assets/how-to/tree-drawer.png)

## Follow the contents pane

The left-hand "On this page" pane lists the current document's headings as a
numbered outline. WebDocs numbers the headings for you — 1, 1.1, 1.2.1, and so
on — and the same numbers appear in the body, so the outline and the page can
never drift apart. Click an entry to scroll that heading to the top of the
content; the pane also tracks your position as you scroll, highlighting the
section you are reading. Clicking an entry scrolls without changing the URL, so
you can range around a long document freely.

## Read the breadcrumb trail

The breadcrumb trail in the header shows where the current document sits, as its
id path with " › " separators — a document with id `Docs/features/map` reads as
Docs › features › map. It is a location indicator, not a set of links: there is
nothing to click. To move up or across, use the tree drawer.

## Deep-link to a document, heading, or requirement

Every document has a stable URL you can share:

- To a document — append `#/<id>` to the app URL, for example
  `#/Docs/features/map`. The id mirrors the folder path you see in the
  breadcrumbs.
- To a heading — every heading gets a slug id, so an in-page `#anchor` scrolls
  straight to that section.
- To a requirement or test — append `?req=<id>` or `?test=<id>` to a document
  route. WebDocs scrolls the item to the centre of the view and flashes it
  briefly so you can spot it.

An unknown document id falls back to the default document rather than erroring.
