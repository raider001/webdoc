<!--meta
{
  "title": "System Requirements",
  "description": "Top-level requirements for the Web Document Tool.",
  "assumes": ["Guides/getting-started"],
  "next": ["Guides/detailed-requirements"]
}
-->

# System Requirements

These are the high-level system requirements. Detailed requirements in other
documents trace **up** to these, and the **Trace From** column below is filled in
automatically from those inbound traces.

<!--meta start {"requirement-group":"sys"}-->
| requirement-no | description | trace-to |
| -------------- | ----------- | -------- |
| 1 | The tool shall render CommonMark-compliant Markdown. | |
| 2 | The tool shall reject all styling from embedded HTML. | |
| 3 | The tool shall trace requirements across documents. | |
<!--meta end {"requirement-group":"sys"}-->

Each requirement id is composed automatically as
`{component}_{group}_{number}` — here the component `GUIDE` comes from the server
config, `sys` is the requirement-group, and the number is the row.
