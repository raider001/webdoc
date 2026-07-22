<!--meta
{ "title": "Map Requirements", "description": "Functional requirements for the map view.", "assumes": ["Docs/requirements/system"], "next": [] }
-->

# Map Requirements

Functional requirements for the map view — the `map` group. The map is a
hand-rolled SVG graph whose nodes are documents and whose edges are derived from
metadata: prerequisite edges from `assumes`, recommended-next edges from `next`,
requirement-trace edges from requirement trace-to links, and page-link edges
from in-body links. It supports pan, zoom, node search, a minimap, a legend with
per-category toggles, and select-and-stay selection. Every row traces up to
`sys_4` (visualise how documents and requirements relate) and composes to
`R_WD_MAP_{no}`.

<!--meta start {"requirement-group":"map"}-->
| requirement-no | description | trace-to |
| --- | --- | --- |
| 1 | Lay out documents as a graph from their metadata. | sys_4 |
| 2 | Pan, zoom and search the map. | sys_4 |
| 3 | Distinguish prerequisite, recommended-next, requirement-trace and page-link edges. | sys_4 |
| 4 | Show external links as boxes that open in a new tab. | sys_4 |
| 5 | Toggle each edge category from the legend. | sys_4 |
| 6 | Select a document on the map and open it on return. | sys_4 |
<!--meta end {"requirement-group":"map"}-->
