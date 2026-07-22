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

To change a document you are reading, click the floating pencil button (✎, "Edit
this document") at the bottom of the content. WebDocs turns the stored Markdown
back into editable blocks — headings, text, lists, code, tables, quotes,
images, requirement groups, and test cases — with the auto-generated section
numbers stripped, so you only ever see and edit the heading text.

![The block editor with the Document metadata panel on the right, showing the title, description, and the assumes / next chips.](/assets/how-to/editor.png)

## Link to other documents

Inside a text block, select some text and click the 🔗 button to open the link
popover. Its URL box autocompletes against your documents: pick one and it
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

Click Save. WebDocs serializes every block back to Markdown, writes the whole
file to its source folder, and then re-discovers the set — so a brand-new
document appears in the tree, search, and map straight away, with no config
change and no restart. The header is always written with the four fields
`title`, `description`, `assumes`, and `next`, in that order.
