<!--meta
{ "title": "How-To Guide", "description": "A task-oriented set of recipes for the everyday WebDocs jobs — one short document per job, linked together.", "assumes": ["Docs/overview"], "next": ["Docs/how-to/running"] }
-->

# How-To Guide

This guide collects the everyday jobs you do with WebDocs and gives each one its
own short recipe. It favours doing over explaining: every page is a few tight
steps, and where a job carries rules and edge cases the recipe hands you off to
the reference and feature documents that cover them in full. Everything here is
plain Markdown with no build step, so the loop never changes — save a file and
it is part of the set.

![The WebDocs reading view: the document tree lives behind the menu button, the on-this-page contents sit on the left, and the reading pane fills the rest.](/assets/how-to/hero.png)

## The recipes

Read them in order for a tour, or jump straight to the job at hand:

- [Get WebDocs running](Docs/how-to/running) — point the server at a folder of
  Markdown and open the app.
- [Read and navigate](Docs/how-to/navigating) — the tree, the contents pane,
  breadcrumbs, and deep links.
- [Search](Docs/how-to/searching) — find text on a page, and search titles and
  headings across every document.
- [Explore the map](Docs/how-to/map) — the graph of how documents and
  requirements relate.
- [Author a document](Docs/how-to/authoring) — create, edit, describe, link, and
  save, all in the browser.
- [Write your content](Docs/how-to/writing) — the Markdown and GFM you can use,
  code highlighting, and embedded HTML.
- [Add a diagram](Docs/how-to/diagrams) — turn a fenced block into a rendered,
  pannable diagram.
- Add a widget — the blocks you insert from **+ Add widget** in the editor:
  - [Collapsible section](Docs/how-to/collapsible) (`collapse`) — a heading
    readers open and close.
  - [Auto-update section](Docs/how-to/live-widget) (`live`) — part of another
    document, refreshed in place.
  - [Auto-update table](Docs/how-to/live-table) (`live-table`) — a table fed
    from a document, CSV or JSON file, refreshed in place.
  - [Panel, and widgets of your own](Docs/how-to/widget-plugins) (`panel`) — a
    framed container, and how to register a new widget type.
  - [3D model viewer](Docs/features/model-viewer) (`model-viewer` plugin) — an
    interactive glTF `.glb` model with LODs, animations and a rig test dock.
  - [Software designs](Docs/how-to/diagrams) (`software-design` plugin) — UML,
    sequence, activity and wireframe diagrams you edit by drawing.

  The first four are built in. The two plugins load only when they are named in
  `config.json`'s `plugins` list.
- [Trace requirements](Docs/how-to/requirements) — author requirement tables that
  trace to and from one another.
- [Check test coverage](Docs/how-to/coverage) — see which requirements are
  verified and record manual results.
- [Switch day and night](Docs/how-to/theming) — the light and dark themes.
- [Set up accounts](Docs/how-to/accounts) — turn on sign-in, declare access
  groups, and lock a chapter down.

## Where to go next

When a recipe stops short of the fine print, the reference documents take over:
[the authoring reference](Docs/reference/authoring) for the full rules of writing
a document, and [the configuration reference](Docs/reference/config) for standing
up and tuning the set.
