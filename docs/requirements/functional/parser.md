<!--meta
{ "title": "Parser Requirements", "description": "Functional requirements for the Markdown engine.", "assumes": ["Docs/requirements/system"], "next": [] }
-->

# Parser Requirements

Functional requirements for the from-scratch Markdown engine — the `parse`
group. These constrain what the two-phase CommonMark + GFM parser must accept
and how faithfully it must implement the specification. Rows 1 through 3 trace
up to `sys_1` (render authored Markdown as a browsable document); row 4 traces
to `sys_6` (zero third-party runtime dependencies), because the engine is
hand-written rather than pulled from a library. Each row resolves to an id of
the form `WD_parse_{no}`.

<!--meta start {"requirement-group":"parse"}-->
| requirement-no | description | trace-to |
| --- | --- | --- |
| 1 | Parse the CommonMark 0.31.2 specification. | sys_1 |
| 2 | Support GFM tables, task lists, strikethrough and autolinks. | sys_1 |
| 3 | Reach at least 99% conformance against the official spec suite. | sys_1 |
| 4 | Use no third-party parsing library. | sys_6 |
<!--meta end {"requirement-group":"parse"}-->
