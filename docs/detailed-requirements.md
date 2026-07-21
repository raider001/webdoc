<!--meta
{
  "title": "Detailed Requirements",
  "description": "Functional requirements that trace up to the system requirements.",
  "assumes": ["Guides/Requirements"],
  "next": []
}
-->

# Detailed Requirements

Each functional requirement below **traces to** a system requirement. The
`trace-to` value is a requirement reference — a bare number (same group),
`group_number` (same component), or a full composed id. Every reference renders
as a link to the target requirement's document; the System Requirements document
shows the inverse **Trace From** links automatically.

<!--meta start {"requirement-group":"fn"}-->
| requirement-no | description | trace-to |
| -------------- | ----------- | -------- |
| 1 | Parse Markdown per the CommonMark 0.31.2 spec. | sys_1 |
| 2 | Strip style, class and script from embedded HTML. | sys_2 |
| 3 | Compose requirement ids as component_group_number. | sys_3 |
| 4 | Garbage. | sys_3 |
| 5 | Calculate reverse trace links for every requirement. | sys_3, sys_99 |
<!--meta end {"requirement-group":"fn"}-->

Note `fn_4` traces to `sys_99`, which does not exist — an unresolved reference is
shown as a flagged ⚠ rather than a broken link.
