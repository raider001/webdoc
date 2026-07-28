<!--meta
{ "title": "Highlighting Requirements", "description": "Functional requirements for syntax highlighting.", "assumes": ["Docs/requirements/system"], "next": [] }
-->

# Highlighting Requirements

Functional requirements for the hand-written syntax highlighters — the `hl`
group. Highlighting is provided by per-language tokenizers that run after
sanitization and colour tokens with theme-aware classes. Each supported language
is its own requirement so that support can be traced and tested independently.
All rows trace up to `sys_1` (render authored Markdown as a browsable document)
and compose to `R_WD_HL_{no}`.

<!--meta start {"requirement-group":"hl"}-->
| requirement-no | description | trace-to |
| --- | --- | --- |
| 1 | Highlight Python. | sys_1 |
| 2 | Highlight Robot Framework. | sys_1 |
| 3 | Highlight Makefile. | sys_1 |
| 4 | Highlight shell. | sys_1 |
| 5 | Highlight Java. | sys_1 |
<!--meta end {"requirement-group":"hl"}-->
