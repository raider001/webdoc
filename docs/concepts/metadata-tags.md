<!--meta
{
  "title": "Metadata Tags",
  "description": "The JSON metadata block every document carries, and what each field means.",
  "assumes": ["Guides/getting-started", "Guides/concepts/graph-model"],
  "next": ["Guides/getting-started"]
}
-->

# Metadata Tags

Each document begins with a small JSON block wrapped in an HTML comment. It is
stripped before the Markdown is parsed, so it never affects the rendered page.

## The fields

1. **title** — the page title, shown in the tree, the map, and the tab.
2. **description** — a one-line summary used in the map and search.
3. **assumes** — a list of document ids to read first.
4. **next** — a list of document ids to read afterwards.

## Referencing other documents

Both `assumes` and `next` reference other documents by their id, which is the
source folder plus the file path without the extension — for example
`Guides/concepts/graph-model`.

## A note on styling

You can embed raw HTML in a document, but any styling is rejected. The security
demonstration document shows exactly what survives and what does not.
