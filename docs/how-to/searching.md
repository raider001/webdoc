<!--meta
{ "title": "Search", "description": "Find text on the current page, and search titles and headings across every document.", "assumes": ["Docs/how-to/navigating"], "next": ["Docs/how-to/map"] }
-->

# Search

WebDocs has two search boxes that do different jobs: one finds text on the page
you are reading, the other looks across the whole set. See
[Search](Docs/features/search) for the difference in full.

## Find text on the current page

The "Find in page…" box in the header highlights matches in the document you are
reading. Type at least two characters; every occurrence is highlighted and the
first is scrolled to the centre of the view. It searches only the current
document and skips text inside code blocks, so a term that appears only in a
code sample will not match. There is no next/previous stepping and no match
count — all matches stay highlighted, so scroll to reach the later ones. Clear
the box, or drop to a single character, to remove the highlights.

![In-page find highlighting every occurrence of a search term in the reading pane.](/assets/how-to/in-page-find.png)

## Search every document

To search the whole set, open the tree drawer and type in "Search all
documents…". This matches document titles and their headings — not full body
text — as a case-insensitive substring, and returns up to fifty results ranked
with title matches first. A single character is enough to start. Click a result
to open that document; Ctrl-, Cmd-, or Shift-click opens it in a new tab.

![All-documents search in the drawer, each result showing its title and the headings that matched.](/assets/how-to/all-search.png)
