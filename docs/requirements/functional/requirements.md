<!--meta
{ "title": "Requirements-Feature Requirements", "description": "Functional requirements for requirement traceability.", "assumes": ["Docs/requirements/system"], "next": [] }
-->

# Requirements-Feature Requirements

Functional requirements for the traceability feature itself — the `req` group.
Requirements are authored as metadata-wrapped Markdown tables; each row composes
a unique id from the component, group and number; authored `trace-to` links
point at the target requirement's document; and the inverse `trace-from` links
are calculated across the whole set. Every row traces up to `sys_5` (trace
requirements to and from one another across documents) and composes to
`WD_req_{no}`.

<!--meta start {"requirement-group":"req"}-->
| requirement-no | description | trace-to |
| --- | --- | --- |
| 1 | Author requirements as metadata-wrapped tables. | sys_5 |
| 2 | Compose a unique id per requirement from component, group and number. | sys_5 |
| 3 | Calculate the inverse trace-from links automatically. | sys_5 |
| 4 | Link every trace to the target requirement's document. | sys_5 |
<!--meta end {"requirement-group":"req"}-->
