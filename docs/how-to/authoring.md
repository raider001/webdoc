<!--meta
{ "title": "Author a Document", "description": "Create, describe, link and save a document in the browser — or write the Markdown by hand.", "assumes": ["Docs/how-to/map"], "next": ["Docs/how-to/writing"] }
-->

# Author a Document

Authoring can be fully visual: WebDocs edits a document as a stack of blocks and
serializes them back to a `.md` file — though you can still write that file by
hand (see [the authoring reference](Docs/reference/authoring)).

## Create the document

Click the ＋ button in the header, titled "New document". In the dialog:

- Pick a component / source — the folder your document belongs to. The source
  name becomes the first segment of the document id.
- Type a path — the folders and name beneath that source, for example
  `guides/setup/installation`. Do not add `.md`, and leading and trailing
  slashes are trimmed. A live "Will create:" line previews the resulting id.

![The New document dialog, with a source dropdown, a path field, and the live "Will create:" preview of the resulting id.](/assets/how-to/new-doc.png)

Paths may contain letters, numbers, and `-` `_` `/` only, and the id must not
already exist. On Create, WebDocs derives a starting title from the last path
segment, opens the editor with a level-1 heading and one empty paragraph, and
you are ready to write.

## Write the metadata header

Every document opens with a metadata header — an HTML comment whose body is a
single JSON object, read and removed before the Markdown is parsed, so it never
shows on the page. The editor's "Document metadata" panel writes these fields
for you, but it is worth knowing the shape:

```text
<!--meta
{
  "title": "Installing WebDocs",
  "description": "Get the server running and open your first document.",
  "assumes": ["Docs/overview"],
  "next": ["Docs/reference/authoring"]
}
-->
```

- `title` — the display name; keep it identical to the single # H1 that
  follows. It feeds the tree, the search index, the map node, and the browser
  tab.
- `description` — a one-line summary, rendered as the lede beneath the H1.
- `assumes` — prerequisite document ids, drawn as prerequisite edges on the map
  and as "assumed knowledge" links in the footer. May be empty.
- `next` — recommended-next document ids, drawn as recommended-next edges and
  footer "next" links. May be empty.

Every id in `assumes` and `next` must be a real document id.

## Edit an existing document

To change a document you are reading, click **Edit** (the pencil, "Edit
this document") at the top right of the content. **Delete** is labelled separately
below it. WebDocs turns the stored Markdown
back into editable blocks — headings, text, lists, code, tables, quotes,
images, requirement groups, and test cases — with the auto-generated section
numbers stripped, so you only ever see and edit the heading text.

![The block editor with the Document metadata panel on the right, showing the title, description, and the assumes / next chips.](/assets/how-to/editor.png)

## Link to other documents

Inside a text block, select some text and click **Link**, or press Ctrl/Cmd+K
at a caret, to open the link dialog. Its URL box autocompletes against your documents: pick one and it
inserts that document's id — no `.md`, no leading slash. Type a real URL (one
starting with a scheme, `/`, `./`, `../`, `#`, `mailto:`, or `tel:`) and the
document suggestions step aside so external links work freely. A bare domain
such as example.org gets `https://` prepended, and unsafe schemes such as
`javascript:` are rejected. If you are writing Markdown by hand instead, an
internal link is just the id:

```text
[the configuration reference](Docs/reference/config)
```

An in-body link to another document that is not already an `assumes`, `next`, or
trace relationship is drawn on the map as a page-link edge, so cross-references
show up as structure, not clutter — use them freely but deliberately.

## Save

Click Save, or press Ctrl/Cmd+S. WebDocs serializes every block back to Markdown, writes the whole
file to its source folder, and then re-discovers the set — so a brand-new
document appears in the tree, search, and map straight away, with no config
change and no restart. The editor stays open with a visible **Saved** status.
Cancel returns to reading; if there are unsaved changes it first asks whether
to discard them. Navigation, reload and closing the tab also guard unsaved work.
The header is always written with the four fields
`title`, `description`, `assumes`, and `next`, in that order.

## Work with blocks

Enter splits text at the caret into a new paragraph. Shift+Enter inserts a line
break. Backspace at the start joins adjacent text blocks; Delete at the end
joins the next one. In a list, Enter makes another item; Enter on an empty item
returns to a paragraph. Plain Enter in a table cell keeps the cell intact.

Each block has one actions handle. Click it for Move up/down, Insert below,
Change block type (text, headings, quotes, lists and code), or Delete block.
Drag the handle to reorder, including on touch screens. Escape moves focus to
the handle; Up/Down move between handles, Enter opens its menu, and the menu
supports Up/Down, Home/End and Escape. Alt+Up/Down move the current block.
Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo edits. A deleted block also offers
an Undo message. Undo history lasts for this editing session.

Tables offer insert-before, insert-after and delete controls for each row and
column. The final column is kept. Image blocks show a preview; the URL and alt
text remain editable. Ctrl/Cmd+Shift+G opens the inline image dialog.

Open **Metadata** to edit the title, description and relationships. The panel
starts collapsed to leave room for writing, and relationship pickers search by
title or document id. A visible warning appears whenever Title differs from
the first H1 (or the H1 is missing); update either field to make them agree.
Requirement descriptions and test names grow to show their full text.
