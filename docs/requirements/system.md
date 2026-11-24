<!--meta
{ "title": "System Requirements", "description": "The top-level requirements for WebDocs; functional requirements trace up to these.", "assumes": ["Docs/features/requirements"], "next": [] }
-->

# System Requirements

This document holds the top-level, system-level requirements for WebDocs — the
`sys` group. These are deliberately broad statements of intent: each one names a
capability the product as a whole must provide, without prescribing how it is
built. Every functional requirement elsewhere in the set traces *up* to one of
these rows, so the **Trace From** column below fills in automatically as the
functional groups are authored. Because these are the roots of the traceability
tree, their own **Trace To** column is left blank.

Each row composes a stable identifier of the form `R_WD_SYS_{no}` — the id
carries an `R_` prefix and is fully uppercased, so `WD` is the component id
configured for this documentation set, `sys` is the group, and the number is the
row (row 1 becomes `R_WD_SYS_1`). Authored short refs like `sys_1` still work and
resolve case-insensitively to that uppercase id. For the mechanics of composition
and inverse traceability see
[Requirements Traceability](Docs/features/requirements).

<!--meta start {"requirement-group":"sys"}-->
| requirement-no | description | trace-to |
| --- | --- | --- |
| 1 | WebDocs shall render authored Markdown as a browsable document. | |
| 2 | WebDocs shall allow embedded HTML but reject all styling and scripting. | |
| 3 | WebDocs shall let a reader navigate the whole document set. | |
| 4 | WebDocs shall visualise how documents and requirements relate. | |
| 5 | WebDocs shall trace requirements to and from one another across documents. | |
| 6 | WebDocs shall depend on no third-party code at run time on the server, and shall ship no third-party code to the browser beyond the compiled UI framework runtime. | |
| 7 | WebDocs shall adapt its presentation to the reader's preferences. | |
| 8 | WebDocs shall restrict who may read and modify each document. | |
| 9 | WebDocs shall be distributed as a release archive that runs with a Python 3 interpreter alone, requiring no Node.js, no package installation and no network. | |
| 10 | WebDocs shall carry third-party packages only as build-time development dependencies, with the package manifest's runtime dependencies object left empty. | |
| 11 | WebDocs shall keep its server within the Python standard library and shall run with no Node.js installed. | |
<!--meta end {"requirement-group":"sys"}-->

## Why rows 9 to 11 are worded the way they are

Row 6 once read "WebDocs shall ship with zero third-party runtime dependencies",
and for eleven stages that was literally true. It stopped being true when the
interactive chrome moved onto Svelte 5 (see [the roadmap](Docs/roadmap)), which
compiles a framework runtime into the browser bundle. The row was amended rather
than dropped, because the halves readers actually depended on both survived: the
server still runs on the Python standard library alone, and nothing beyond that
one compiled runtime reaches the browser.

Rows 9 to 11 are the checkable form of what row 6 had been standing in for. Each
is a mechanical property rather than a matter of judgement, and each already has
a gate in the automated suite: `tests/test_build_current.py` fails if the
committed bundle is stale against the Svelte sources it is built from, or if the
package manifest's runtime `dependencies` object stops being empty, and
`tests/test_build_externals.py` fails if the bundle carries an import a browser
could not resolve for itself. Running the whole suite on a machine with no
Node.js installed is what demonstrates rows 9 and 11 together: the externals
checks read the committed bundle and need no toolchain at all, while the rebuild
comparison skips rather than fails, deliberately, because having no toolchain is
the very condition it is there to protect.

Rows here are appended, never inserted. A row's number is part of its id, so
inserting one in the middle would renumber every row below it and silently
repoint every trace aimed at the old numbers, with nothing shown to a reader to
say that it had happened.
