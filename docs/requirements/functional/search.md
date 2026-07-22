<!--meta
{ "title": "Search Requirements", "description": "Functional requirements for search.", "assumes": ["Docs/requirements/system"], "next": [] }
-->

# Search Requirements

Functional requirements for all-document search — the `search` group. When the
library loads, an index of document titles and headings is built so the drawer
search box can match across the whole set and jump straight to the matching
document (matched headings are shown as context). Search is deliberately scoped to titles and headings rather
than full body text, keeping it light and fast. Both rows trace up to `sys_3`
(let a reader navigate the whole document set) and compose to `R_WD_SEARCH_{no}`.

<!--meta start {"requirement-group":"search"}-->
| requirement-no | description | trace-to |
| --- | --- | --- |
| 1 | Search all documents by title. | sys_3 |
| 2 | Search all documents by heading. | sys_3 |
<!--meta end {"requirement-group":"search"}-->
