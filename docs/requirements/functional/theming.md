<!--meta
{ "title": "Theming Requirements", "description": "Functional requirements for theming.", "assumes": ["Docs/requirements/system"], "next": [] }
-->

# Theming Requirements

Functional requirements for day/night theming — the `theme` group. Themes are
expressed as CSS custom-property design tokens switched by a `[data-theme]`
attribute and resolved before first paint, so there is no flash of the wrong
theme. On first load the operating-system preference is honoured, and any choice
the reader makes afterward is remembered. Every row traces up to `sys_7` (adapt
its presentation to the reader's preferences) and composes to `R_WD_THEME_{no}`.

<!--meta start {"requirement-group":"theme"}-->
| requirement-no | description | trace-to |
| --- | --- | --- |
| 1 | Offer a day and a night theme. | sys_7 |
| 2 | Honour the operating-system preference on first load. | sys_7 |
| 3 | Remember the reader's choice. | sys_7 |
<!--meta end {"requirement-group":"theme"}-->
