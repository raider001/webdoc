<!--meta
{ "title": "System Requirements", "description": "The top-level requirements for WebDocs; functional requirements trace up to these.", "assumes": ["Docs/features/requirements"], "next": [] }
-->

# System Requirements

This document holds the top-level, system-level requirements for WebDocs — the
`sys` group. These are deliberately broad statements of intent: each one names a
capability the product as a whole must provide, without prescribing how it is
built. Every functional requirement elsewhere in the set traces *up* to one of
these rows, so the **Trace From** column below fills in automatically as the
functional groups are authored. Because these are the roots of the traceability
tree, their own **Trace To** column is left blank.

Each row composes a stable identifier of the form `WD_sys_{no}` — `WD` is the
component id configured for this documentation set, `sys` is the group, and the
number is the row. For the mechanics of composition and inverse traceability see
[Requirements Traceability](Docs/features/requirements).

<!--meta start {"requirement-group":"sys"}-->
| requirement-no | description | trace-to |
| --- | --- | --- |
| 1 | WebDocs shall render authored Markdown as a browsable document. | |
| 2 | WebDocs shall allow embedded HTML but reject all styling and scripting. | |
| 3 | WebDocs shall let a reader navigate the whole document set. | |
| 4 | WebDocs shall visualise how documents and requirements relate. | |
| 5 | WebDocs shall trace requirements to and from one another across documents. | |
| 6 | WebDocs shall ship with zero third-party runtime dependencies. | |
| 7 | WebDocs shall adapt its presentation to the reader's preferences. | |
<!--meta end {"requirement-group":"sys"}-->
