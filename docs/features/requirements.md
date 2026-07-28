<!--meta
{ "title": "Requirements Traceability", "description": "Author requirement tables that trace to and from requirements across documents.", "assumes": ["Docs/overview"], "next": ["Docs/requirements/system"] }
-->

# Requirements Traceability

WebDocs is not only a reader — it is a lightweight requirements tool. You author
requirements as ordinary Markdown tables, wrapped in a pair of metadata comments,
and WebDocs turns them into uniquely identified, cross-referenced, traceable
requirements. Trace links you author in one direction are inverted automatically,
so a requirement always shows both what it traces *to* and what traces *from* it.

## A requirement group

A requirement group is a Markdown table bracketed by a `start` and `end` meta
comment that names the group. The table has three authored columns —
`requirement-no`, `description` and `trace-to`:

```text
<!--meta start {"requirement-group":"parse"}-->
| requirement-no | description                                      | trace-to |
| -------------- | ------------------------------------------------ | -------- |
| 1              | Parse the CommonMark 0.31.2 specification.       | sys_1    |
| 2              | Support GFM tables, task lists and strikethrough.| sys_1    |
| 3              | Use no third-party parsing library.              | sys_6    |
<!--meta end {"requirement-group":"parse"}-->
```

WebDocs extracts this block before the surrounding Markdown is parsed and renders
it as a five-column table: **Requirement | Description | Trace To | Trace From |
Verified By**. The first three columns come from what you wrote; both *Trace From*
and *Verified By* are computed inverses — *Trace From* by inverting the trace-to
links of every other requirement, and *Verified By* by inverting each test case
whose `verifies` references this requirement. See
[Test coverage](Docs/features/test-coverage) for how test cases link back to the
requirements they verify.

## How ids are composed

Each row is given a stable, unique id composed of three parts:

    R_{COMPONENT}_{GROUP}_{REQUIREMENT-NO}

- **component** comes from configuration — the source's `component`, which for
  this project is `WD`.
- **group** is the name in the meta comment — `parse` above.
- **requirement-no** is the number in the first column.

Every id carries a mandatory `R_` prefix and is upper-cased in full, so row 1 of
the `parse` group becomes `R_WD_PARSE_1`. Because the component is configured per
source and the group is named at the table, ids stay unique across every document
without any manual bookkeeping.

## Trace-to and trace-from

You author **trace-to**: a reference to another requirement that this one depends
on or refines. A bare reference like `sys_1` is resolved against the component to
`R_WD_SYS_1`, and the rendered link points at the *document that defines that
requirement* — so a trace is a real, clickable jump across the document set.
Multiple targets are comma-separated, and a top-level requirement leaves the
column blank.

**Trace-from** is never authored. WebDocs calculates it by inverting every
trace-to across the whole set: if `R_WD_PARSE_1` traces to `R_WD_SYS_1`, then
`R_WD_SYS_1` automatically shows `R_WD_PARSE_1` in its Trace From column. This is
also what feeds the requirement-trace edges on [the map](Docs/features/map),
connecting the documents whose requirements reference one another.

## Where to go next

- [The system requirements](Docs/requirements/system) hold the top-level `sys`
  group that the functional requirements trace up to; their Trace From columns
  fill in from those functional groups.
- [The authoring reference](Docs/reference/authoring) covers the exact metadata
  and table syntax alongside the rest of the document format.
