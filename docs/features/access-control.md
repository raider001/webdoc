<!--meta
{ "title": "Accounts & Access Control", "description": "Sign-in, access groups, and locking pages and sections down the Recommended-next chain.", "assumes": ["Docs/features/map"], "next": ["Docs/how-to/accounts"] }
-->

# Accounts & Access Control

WebDocs can run as an open library — anyone who can reach the server reads and
edits everything — or as a private one, where each reader signs in and sees only
the pages their groups allow. Which of the two you get is a single line of
configuration, and the open behaviour is the default: a WebDocs install that has
never heard of accounts keeps working exactly as it did.

This page explains the model. To switch it on, see
[Set up accounts](Docs/how-to/accounts).

## The shape of it

There are three moving parts, and they are deliberately separate:

- **Accounts** live in one JSON file outside every served folder. A password is
  stored only as a PBKDF2-HMAC-SHA256 hash with a per-account salt; a session is
  a random token held in the server's memory, never written to disk.
- **Groups** are declared once in `config.json`. A group is just a name — `staff`,
  `ops`, `release` — and an administrator decides who is in it.
- **Access rules** live in the documents themselves, in the same `<!--meta-->`
  header that already carries `title` and `next`. A rule names the groups that
  may read (or modify) a page.

Putting the rules in the documents is the important choice. It means a
permission travels with its page through a `git` commit, a rename or a backup,
and that a review of who can see what is a review of the same files everything
else about the page lives in. There is no second database to drift out of step
with the library.

## Locking a page

A page declares its own rule in its metadata header:

```json
<!--meta
{
  "title": "Release process",
  "next": ["Docs/deploy"],
  "access": { "read": ["release"], "write": ["release"] }
}
-->
```

`read` names the groups that may open the page; `write` names those that may
change it. Either may be omitted. A page with no `access` block at all is
readable by anyone signed in — and by anyone at all if the server sets
`publicRead`.

## Locking a chapter: propagation down Recommended next

A rule does not stop at the page that declares it. It flows **recursively along
`next`** — the same *Recommended next* edges the [Map](Docs/features/map) draws —
so locking the entry point of a chapter locks the chapter.

If `Docs/release/intro` declares `read: ["release"]` and lists
`Docs/release/staging` in its `next`, then `staging` inherits the rule, and so
does everything `staging` recommends after it, for as far as the chain runs.

Three rules govern how that inheritance behaves, and they exist because the
alternatives all produce surprises:

- **A page that declares its own `read` stops inheriting one.** Its rule wins
  outright; propagation continues from it with *its* groups.
- **Two paths union their groups.** If a page is reachable from a `release` page
  *and* from an `ops` page, either group may read it — because a reader who was
  allowed to walk that path must be able to keep walking it. Intersecting would
  strand readers halfway through a chapter they were invited into.
- **Cycles are safe.** Group sets only ever grow, so a `next` loop settles
  instead of spinning.

You can opt out at either end: `"propagate": false` stops a rule at the page that
declares it, and `"inherit": false` makes a page ignore whatever is coming down
the chain at it.

By default a rule follows `next` only. To make it follow `assumes` (prerequisite)
edges as well, set `"propagateVia": ["next", "assumes"]` in the server's `auth`
block.

## Locked, and hidden

There are two different things "you cannot read this" can mean, and WebDocs makes
you choose.

**Locked** is the default. The page still exists as far as the reader is
concerned: it appears on the map with a padlock and a colour band for the groups
that *could* open it, it is listed in the document tree, and its title still
matches a search. Opening it shows a panel naming the groups to ask for. This is
usually what you want — a reader who can see that a runbook exists and who owns
it can go and ask for access.

**Hidden** is the stronger form, switched on with `"hidden": true`. The page
becomes indistinguishable from one that was never written: absent from the map,
the tree, the directory listing and search; a link to it renders as a dangling
link; and a direct request for its URL returns exactly the same `404` as a
request for a filename that does not exist.

| | Locked | Hidden |
| --- | --- | --- |
| Shown on the map | Yes, with a padlock | No |
| Listed in the tree | Yes, greyed | No |
| Found by search | Title only, no snippet | No |
| Direct URL | `403`, naming the groups | `404`, identical to a missing file |

## Restricting part of a page

A whole page is often the wrong unit. A section of one is marked with a paired
comment in the body:

```markdown
Anyone may read this paragraph.

<!--access start {"read": ["ops"], "label": "Production runbook"}-->

## Production runbook

Restart the appliance with the ops key, then verify the health probe.

<!--access end-->

And this paragraph is public again.
```

For a reader in `ops` the section renders as ordinary Markdown — the markers are
HTML comments and disappear like any other. For everyone else the **server**
removes the section before the file is sent and replaces it with a notice naming
the group needed. The withholding happens on the server, not in the browser,
because the browser is handed the raw Markdown: a client-side filter would be
decoration, not a control.

Two consequences worth knowing:

- **Restricted sections are not in the search index at all** — not even for the
  people who can read them. An index entry is a quotable snippet, and a snippet
  of a withheld paragraph is the leak the section exists to prevent. The same
  applies to requirement groups and test cases written inside a restricted
  section: keep those outside one.
- **A page you can only partly see is read-only for you.** Saving it back would
  overwrite the sections you were never shown, so the editor is not offered and
  the server refuses the write.

## Images, reports and other files

A file that is not a document carries no metadata, so it cannot declare a rule.
It borrows one instead, and it borrows it from the pages that actually **use**
it: an image is readable if you can read at least one page that links to it. A
diagram embedded in a public page is public; the same diagram embedded only in a
locked page is locked, and it becomes locked the moment that page does.

If nothing in the library links to a file, it falls back to its folder — every
document in the nearest folder above it that has any must be readable. Nothing in
the app can surface an unreferenced file, so the strict reading there costs
nobody anything.

This matters because the obvious alternative does not work. "As restricted as the
strictest document in the same folder" sounds safe, but one locked page at a
source root makes every logo and diagram at that level disappear.

## Who may change a rule

Editing a page and changing who can see it are separate rights. By default only
administrators hold the second one, configurable with `aclGroups`.

Without that split the whole model would be advisory: anyone who could edit a
locked page could simply delete its `access` block and publish it. So on every
save the server compares the access rules in the incoming document with the ones
already on disk, and if they differ the writer must additionally hold
access-management rights. Rewording the page is fine; rewriting its permissions
is not. Deleting a restricted page needs the same right, because deleting a page
deletes its rule with it.

## Seeing it on the map

The [Map](Docs/features/map) is where the shape of all this becomes legible. Each
node carries a colour band down its left edge — one stripe per group that can
read it — so a locked chapter reads as a run of same-coloured pages, and the page
where a lock *starts* is visible as the point the colour begins. Pages this
account cannot open show a padlock and withhold their description.

An **Access groups** legend lists every group in play; clicking one dims the
pages only that group can read, which answers "what does Ops actually see?" in a
click. Hidden pages are simply not there.

## What the server enforces

Everything. The browser hides an edit button it knows will fail and greys a
locked page in the tree, but not one of those is a control — each request is
decided again on the server, from the same access rule, at every one of these
points:

| Surface | Rule applied |
| --- | --- |
| `GET /docs/<source>/<path>.md` | Read on the page; restricted sections stripped |
| `GET /docs/<source>/<dir>/` | Hidden pages and empty folders omitted |
| Non-Markdown files | As visible as the pages that link to them (see below) |
| `PUT` / `DELETE /docs/…` | Write on the page, plus ACL rights if a rule changed |
| `/api/index/search` | Hidden dropped before paging; locked keep the title only |
| `/api/index/tree` | Hidden omitted; locked flagged |
| `/api/index/graph` | Hidden nodes and their edges removed; locked stripped of description |
| `/api/index/coverage` | Requirements and tests of unreadable pages omitted |
| `/api/index/resolve` | A hidden target resolves to nothing |
| `/api/tests`, `/api/auto` | Results keyed to unreadable pages filtered out |

Every state-changing request also carries a CSRF token, and the app is served
with a `Content-Security-Policy` that admits only same-origin code.

## Failing closed

Every ambiguity in this model resolves toward *less* access, because the
alternative is a page that quietly publishes itself:

- **A metadata header that will not parse** makes the page administrators-only.
  A stray comma used to leave `access` unreadable and therefore absent, which
  read as "declares no rule". A loud lock-out is the safer failure, and an
  administrator can still open the page to fix it.
- **An access rule that will not parse** does the same for that page or section.
- **An unterminated access marker** restricts to the end of the file rather than
  stopping at the next blank line. (A marker written inside a code fence or an
  inline code span is prose *about* the syntax and is ignored — which is what
  lets this page document the syntax without hiding itself.)
- **A section rule that names no groups** is administrators-only. Writing the
  marker at all is an unambiguous intent to restrict.
- **While the index is still building**, document requests answer `503` rather
  than being served. An unknown rule is not the same as no rule.
- **A file the reader can only partly see** cannot be saved or deleted by them.
- **A file nothing links to** inherits from the nearest folder above it that has
  documents, and every document there must be readable. Nothing in the app can
  surface an unreferenced file, so the strict reading costs nobody anything.

Two more things the server does that are worth knowing:

- A `wd-restricted` code fence written by an *author* is renamed before the page
  is sent, so only the server can produce a restriction notice. Otherwise a
  document could forge one — and, worse, wrap real content in a fake one so that
  readers who *are* cleared never see it.
- On a restricted page, the **Assumed knowledge** and **Recommended next** lists
  are part of the access rule: they are what carries the lock downstream, so
  changing them needs access-management rights too.

## When accounts are off

With no `auth` block — or `"enabled": false` — none of the above is on the
request path. There is no sign-in screen, no CSRF token, no filtering, and
anonymous callers read *and* write everything, exactly as they did before this
feature existed. An `access` block sitting in a document is inert until you turn
accounts on, which means you can plan a permission layout, commit it, and switch
it on when you are ready.

Read [Set up accounts](Docs/how-to/accounts) next for the practical steps.
