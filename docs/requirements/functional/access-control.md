<!--meta
{ "title": "Access Control Requirements", "description": "Functional requirements for accounts, access groups and restricted content.", "assumes": ["Docs/requirements/system"], "next": [] }
-->

# Access Control Requirements

Functional requirements for accounts and document access — the `acc` group. They
cover four surfaces that have to agree with one another: who the request is
(authentication), what that identity may see (authorisation), how a rule spreads
along the document graph (propagation), and what a reader is *told* about
something they cannot have (disclosure).

Every row traces up to `sys_8` (restrict who may read and modify each document)
and composes to `R_WD_ACC_{no}`. Row 3 traces additionally to `sys_6` (no
third-party code beyond the compiled UI runtime), because the password hashing —
like the rest of the feature — is built on the Python standard library and
hand-written browser code rather than on a library.

<!--meta start {"requirement-group":"acc"}-->
| requirement-no | description | trace-to |
| --- | --- | --- |
| 1 | Behave exactly as an open library when accounts are disabled. | sys_8 |
| 2 | Authenticate a reader with a username and password, and keep a session. | sys_8 |
| 3 | Store a password only as a salted, iterated one-way hash. | sys_8, sys_6 |
| 4 | Let an administrator create accounts and assign them to access groups. | sys_8 |
| 5 | Restrict read and modify access to a document by access group. | sys_8 |
| 6 | Apply a document's access rule recursively along Recommended next. | sys_8, sys_4 |
| 7 | Restrict an individual section of a document by access group. | sys_8 |
| 8 | Show a restricted document on the map while withholding its content. | sys_8, sys_4 |
| 9 | Make a hidden document indistinguishable from one that does not exist. | sys_8 |
| 10 | Require separate rights to change a document's access rule. | sys_8 |
| 11 | Decide every access question on the server, never in the browser. | sys_8 |
| 12 | Show each document's access groups visually on the map. | sys_8, sys_4 |
<!--meta end {"requirement-group":"acc"}-->

## Notes on two of these

**Row 6** is the one that makes the feature usable rather than tedious: a chapter
is locked by locking its entry point. The inheritance is a union across paths, so
a page reachable from two restricted chapters is readable by either chapter's
groups — see [Accounts & Access Control](Docs/features/access-control) for why
the alternative strands readers mid-chapter.

**Row 11** is the reason row 8 is safe. A locked document's title reaches the
browser and its body does not, and that split is made by the server on every
single request — the browser never receives content it then declines to draw.
