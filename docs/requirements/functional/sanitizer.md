<!--meta
{ "title": "Sanitizer Requirements", "description": "Functional requirements for HTML sanitization.", "assumes": ["Docs/requirements/system"], "next": [] }
-->

# Sanitizer Requirements

Functional requirements for the allowlist HTML sanitizer — the `safe` group.
Authored Markdown may embed raw HTML, but the sanitizer runs as a separate DOM
pass after parsing to guarantee nothing in a document can restyle the shell or
execute code. Every row here traces up to `sys_2` (allow embedded HTML but
reject all styling and scripting), and each composes to `R_WD_SAFE_{no}`.

<!--meta start {"requirement-group":"safe"}-->
| requirement-no | description | trace-to |
| --- | --- | --- |
| 1 | Strip inline style, style elements and all class attributes, except a single `language-*` hint retained on `code`/`pre` for the syntax highlighter. | sys_2 |
| 2 | Strip script elements and event-handler attributes. | sys_2 |
| 3 | Reject javascript: and data: URLs. | sys_2 |
<!--meta end {"requirement-group":"safe"}-->
