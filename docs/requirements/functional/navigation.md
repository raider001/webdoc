<!--meta
{ "title": "Navigation Requirements", "description": "Functional requirements for navigation.", "assumes": ["Docs/requirements/system"], "next": [] }
-->

# Navigation Requirements

Functional requirements for moving through the document set — the `nav` group.
Navigation spans three surfaces: the hamburger document tree (between documents),
the on-this-page contents list (within a document), and hash-based deep-links
that address any document or requirement. Every row traces up to `sys_3` (let a
reader navigate the whole document set) and composes to `R_WD_NAV_{no}`.

<!--meta start {"requirement-group":"nav"}-->
| requirement-no | description | trace-to |
| --- | --- | --- |
| 1 | Present the document set as a folder tree. | sys_3 |
| 2 | Show the current document's headings as a contents list. | sys_3 |
| 3 | Deep-link to any document and requirement. | sys_3 |
<!--meta end {"requirement-group":"nav"}-->
