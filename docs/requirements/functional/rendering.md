<!--meta
{ "title": "Rendering Requirements", "description": "Functional requirements for headings and contents.", "assumes": ["Docs/requirements/system"], "next": [] }
-->

# Rendering Requirements

Functional requirements for heading numbering and the contents pane — the `num`
group. After the Markdown is parsed and sanitized, headings are decorated with
hierarchical numbers (1, 1.1, 1.1.1, …) and that same numbering is mirrored in
the on-this-page contents list. Row 1 supports both rendering the document and
navigating it, so it traces to `sys_1` and `sys_3`; row 2 is a navigation
concern and traces to `sys_3` alone. Each row composes to `R_WD_NUM_{no}` (for example `R_WD_NUM_1`).

<!--meta start {"requirement-group":"num"}-->
| requirement-no | description | trace-to |
| --- | --- | --- |
| 1 | Number every heading hierarchically. | sys_1,sys_3 |
| 2 | Mirror the numbering in the table of contents. | sys_3 |
<!--meta end {"requirement-group":"num"}-->
