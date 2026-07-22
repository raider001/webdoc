<!--meta
{ "title": "Search", "description": "Search every document by title and heading from the drawer.", "assumes": ["Docs/features/navigation"], "next": [] }
-->

# Search

Search lets a reader jump to the right document by typing a word or two, without
knowing where it lives in the tree. It is deliberately lightweight: it indexes
the *structure* of every document — titles and headings — rather than the full
body text, which keeps it fast, small and instant.

## What gets indexed

When the library loads, WebDocs walks every document once and builds an in-memory
index from two things:

- **Titles** — the `title` field from each document's metadata header.
- **Headings** — every ATX heading (a line beginning with one to six `#`
  characters) found in the document's raw Markdown source. Setext/underline
  headings, and any `#` lines inside fenced code or requirement/meta blocks, are
  stripped before scanning and so are not indexed.

That is the whole index. The body prose is intentionally *not* indexed. This is a
design choice, not a limitation: titles and headings are the document's own
table of contents, so matching against them points you at the right *section*
almost as reliably as full-text would, while the index stays tiny and the search
stays responsive with zero server round-trips.

## Using it

Open the drawer and type in the search box. As you type:

1. The query is matched against indexed titles and headings.
2. Matching documents are listed, each showing the specific headings that
   matched underneath it.
3. Selecting a result opens that document at the top of the page. The matched
   headings are shown only as context in the result row — they are not jump
   targets — so from there you use the in-page contents or find to reach the
   section you want.

Because results are grouped by document and annotated with the matched headings,
you get useful context before you click: you can see *why* a document matched and
pick the most relevant one.

## How it fits with the rest of navigation

Search complements the two browsing surfaces described in
[navigation](Docs/features/navigation). The document tree is for browsing the set
when you know roughly where you are going; search is for pouncing on a known term
when you do not. Both resolve to the same deep-linkable `#/<docId>` routes, so a
search result is just as shareable as any other view.

## Why not full-text?

Full-text search would mean shipping and querying a much larger index for every
reader, on every load, for a corpus that is already well-structured by its
headings. WebDocs favours the lighter path: index the outline, search it
instantly in the browser, and keep the zero-dependency, no-backend promise
intact.
