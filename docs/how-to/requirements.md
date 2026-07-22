<!--meta
{ "title": "Trace Requirements", "description": "Author requirement tables that compose stable ids and trace to and from one another across documents.", "assumes": ["Docs/how-to/diagrams"], "next": ["Docs/how-to/coverage"] }
-->

# Trace Requirements

A requirement group is an ordinary GFM table wrapped in a matched pair of meta
comments. WebDocs lifts the wrapped region out before parsing and rebuilds it as
a live, cross-linked table.

## Author a requirement group

Wrap a three-column table in the group markers:

```text
<!--meta start {"requirement-group":"nav"}-->
| requirement-no | description                          | trace-to |
| -------------- | ------------------------------------ | -------- |
| 1              | Present the set as a folder tree.    | sys_3    |
| 2              | Show the current headings as a list. | 1, sys_3 |
| 3              | Deep-link to any document.           |          |
<!--meta end {"requirement-group":"nav"}-->
```

The opening marker names the group as JSON; the closing marker ends the region.
The three authored columns are `requirement-no` (aliases `req-no`, `no`,
`requirement`, `#`), `description` (free text, rendered as inline Markdown), and
`trace-to`. Header matching is case-insensitive. Each row is given a stable id
built from three parts — the component, taken from the source's configuration in
`config.json` (`WD` for the Docs source), the group name, and the row number —
and the badge you see on the rendered row reads like `R_WD_NAV_1`.

## Trace to another requirement

`trace-to` holds requirement references only — never free text and never a
document id. There are three shorthands, resolved relative to the row you are
writing:

- A bare number — `2` — points at that number in the same group.
- `group_no` — `sys_1` — points at another group in the same component.
- A fully composed id points anywhere, across components.

Separate several targets with commas, and leave `trace-to` blank for a top-level
requirement. You never author the inverse: WebDocs computes Trace From by
inverting every resolvable `trace-to`, so a requirement shows both what it
depends on and what depends on it. Only resolvable references contribute — a
reference that resolves to nothing is flagged in the Trace To cell as a ⚠ chip,
and produces no inverse link and no map edge.

## Read the rendered table

On the page the group becomes a captioned, scrollable table. Trace To and Trace
From render each reference as a `#/<docId>?req=<id>` link that jumps to the
document defining the target requirement and flashes that row — so a trace is a
real cross-document jump, not just text. Empty cells show an em-dash. The
current build also renders a Verified By column, which lists any test cases
whose metadata points at the requirement; it stays empty until a test does.

![A rendered requirement table with the Requirement, Description, Trace To, Trace From, and Verified By columns and composed id badges.](/assets/how-to/requirement-table.png)

On the map, resolved traces appear as requirement-trace edges: WebDocs collapses
requirement-to-requirement links to a single edge per ordered document pair and
omits traces that stay inside one document. Toggle them with the map's
"Requirement trace" legend button.
[Requirements Traceability](Docs/features/requirements) has the complete rules.
