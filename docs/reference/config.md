<!--meta
{ "title": "Configuration", "description": "config.json sources and components, and the Python static server.", "assumes": ["Docs/reference/authoring"], "next": ["Docs/reference/performance"] }
-->

# Configuration

WebDocs has exactly one configuration file, `config.json`, and one program that
reads it, `serve.py`. Between them they decide what the site is called, which
folders of Markdown make up the library, what component each folder belongs to,
which document opens first, and the default theme. Neither needs a build step:
the server is a thin static file host that also maintains a lightweight search
index (standard-library `sqlite3`), and everything about *how* the documents
render is decided in the browser. See
[Performance & Scale](Docs/reference/performance) for that index and the library
sizes it supports.

This page is the reference for both files. It assumes you know how to write a
document; if not, start with the [Authoring Reference](Docs/reference/authoring).

## config.json

`config.json` lives next to `serve.py` at the project root. It is a small JSON
object:

```json
{
  "siteTitle": "WebDocs",
  "sources": [
    { "name": "Docs", "path": "docs", "component": "WD", "testResults": ".results.xml" }
  ],
  "defaultDoc": "Docs/overview",
  "theme": "auto",
  "plugins": ["mermaid"]
}
```

The fields:

| Field | Type | Default | Meaning |
| ----- | ---- | ------- | ------- |
| `siteTitle` | string | `"Documentation"` | The site name, shown in the header and the browser tab. |
| `sources` | object[] | `[]` | The library: one entry per mounted folder of documents (see below). |
| `defaultDoc` | string | — | The document id opened when no deep-link is present. |
| `theme` | string | `"auto"` | Passed through into `/site.json` but **not currently read** by the browser, so it has no effect on the rendered theme. The live theme is `light` or `dark`, chosen from `localStorage["wd-theme"]` (the reader's remembered choice) or, when nothing is stored, the OS `prefers-color-scheme`. |
| `plugins` | string[] | `[]` | Renderer plugins to enable for rich fenced blocks such as diagrams. Each name loads `app/thirdpartyrenderer/<name>.js`. See [Diagrams & renderer plugins](Docs/features/diagrams). Optional. |
| `auth` | object | — | Accounts and access groups. Absent, or `"enabled": false`, leaves the server open exactly as it was before accounts existed. See [Accounts and access groups](#accounts-and-access-groups). |

Automated test results are configured **per source** with a `testResults` field
on each `sources` entry (see [Sources and components](#sources-and-components)); a
top-level `testResults` key is honored only as a fallback for sources that omit
their own.

The `theme` field is currently **inert**: it is passed through into `/site.json`,
but no client code reads it, so setting it in `config.json` has no effect on the
rendered theme. The first-paint theme is resolved entirely in the browser from
`localStorage["wd-theme"]` (the reader's remembered `light`/`dark` choice) or,
when nothing is stored, the OS `prefers-color-scheme` — applied as the
`data-theme` attribute on `<html>` before the page renders so there is no flash.
See [Theming](Docs/design/theming) for how the full palette is resolved.

## Sources and components

Each entry in `sources` maps a **name** and a **component** onto a folder on
disk:

```json
{ "name": "Docs", "path": "docs", "component": "WD" }
```

- **`name`** is the source's namespace. It becomes the first segment of every
  document id in that folder and the mount point on the server. With `name`
  `Docs` and `path` `docs`, the file `docs/reference/config.md` is served at
  `/docs/Docs/reference/config.md` and has the id `Docs/reference/config`.
- **`path`** is the folder on disk, relative to the project root. It is resolved
  to an absolute path and guarded against escaping the root.
- **`component`** is the requirement-id prefix for every document in the source.
- **`testResults`** *(optional)* names this source's automated xUnit/JUnit
  report. A relative path is served from the source's own mount — the demo's
  `".results.xml"` on `Docs` is fetched from `/docs/Docs/.results.xml` — while an
  absolute path or full URL is used as-is. It feeds the coverage view; see
  [Test results](#test-results). Omit it for a source with no automated report.

You may list several sources to aggregate multiple folders into one site — for
example a `Docs` guide folder and a separate `API` reference folder, each with
its own component. Names must be unique because they namespace the ids.

### The component feeds requirement ids

`component` is **required** for every source. It is a segment of every composed
requirement id, `R_{COMPONENT}_{GROUP}_{NO}` (upper-cased as a whole). With
component `WD`, a requirement numbered `1` in a group named `nav` becomes
`R_WD_NAV_1`; its test cases compose to `T_WD_{key}`. Authors never write the
component into a document — discovery stamps it onto every document from the
source's configuration, so ids stay consistent across a whole folder. See
[Requirements Traceability](Docs/features/requirements) for how the composed ids
and their traces are built.

If a source is missing a non-empty `component`, the server refuses to start and
prints which source is at fault. This is deliberate: a source with no component
could not compose valid requirement ids, so the failure is loud rather than
silent.

## Test results

WebDocs shows two kinds of test results, and both are stored **inside the source
folder they belong to** — never at the project root — so they travel with the
documents and are scoped to a single source.

**Automated results** come from each source's per-source `testResults` file — an
xUnit/JUnit XML report that your test runner produces. A source names its own
report in `config.json` (see [Sources and components](#sources-and-components));
a relative path is served from that source's mount, so the demo's
`".results.xml"` on `Docs` is fetched from `/docs/Docs/.results.xml`. The browser
fetches it and drives the coverage view; see
[Test Coverage](Docs/features/test-coverage) for how each `<testcase>` is matched
to a requirement or test id. Leave `testResults` unset on a source with no
automated report.

**Manual and run results** are entered in the app and stored server-side in a
hidden sidecar named `.webdoc-tests.json` **inside each source folder**, keyed by
requirement or test id. Because it is a dotfile it is omitted from directory
listings, so a hand-recorded result is never mistaken for a document. The server
reads and writes each source's sidecar through a small JSON API:

| Method | Path | Body | Result |
| ------ | ---- | ---- | ------ |
| `GET` | `/api/tests/<source>` | — | `200` with that source's stored JSON (`{}` if the sidecar is missing or unreadable); an unknown source returns `404`. |
| `PUT` | `/api/tests/<source>` | JSON | Validates the body is JSON, writes `.webdoc-tests.json` into that source's folder, and returns `200` `{ "ok": true }`; a non-JSON body returns `400`, an unknown source `404`. |

Both `.results.xml` and `.webdoc-tests.json` are dotfiles, so neither shows up in
the directory listings the browser builds from a source folder.

## Accounts and access groups

The optional `auth` block turns the library from open to private. **It is off
unless you switch it on**: with no `auth` key, or `"enabled": false`, there is no
sign-in, no CSRF token and no filtering, and anonymous callers read *and* write
everything — the behaviour every earlier version had. For the model these
settings drive, see [Accounts & Access
Control](Docs/features/access-control); for the steps, [Set up
accounts](Docs/how-to/accounts).

```json
"auth": {
  "enabled": true,
  "allowRegistration": true,
  "requireApproval": false,
  "publicRead": false,
  "adminGroups": ["admins"],
  "aclGroups": null,
  "writeGroups": null,
  "defaultGroups": [],
  "propagateVia": ["next"],
  "groups": {
    "staff": { "label": "Staff", "color": "#0ea5e9", "description": "Everyone on the team" },
    "ops":   { "label": "Operations" },
    "admins":{ "label": "Administrators" }
  },
  "usersFile": ".webdoc-auth/users.json",
  "cookieSecure": false,
  "trustedProxies": []
}
```

### Who may do what

| Field | Type | Default | Meaning |
| ----- | ---- | ------- | ------- |
| `enabled` | bool | `false` | Master switch. Everything else is inert while this is false. |
| `allowRegistration` | bool | `true` | Whether visitors may create their own account. |
| `requireApproval` | bool | `false` | Registered accounts start disabled until an administrator enables them. |
| `firstUserIsAdmin` | bool | `true` | The first account on an empty server becomes an administrator. Without it a fresh install has nobody who can grant anything. |
| `publicRead` | bool | `false` | Unrestricted documents are readable **without** signing in. Restricted ones still are not. |
| `adminGroups` | string[] | `["admins"]` | Membership of any of these makes an account an administrator. |
| `aclGroups` | string[] \| null | `null` | Who may create or change an access rule. `null` means the admin groups. This is what stops an author widening their own page's permissions. |
| `writeGroups` | string[] \| null | `null` | Who may modify a document that carries no explicit `write` rule. `null` means any signed-in account. |
| `defaultGroups` | string[] | `[]` | Groups a newly registered account joins. |
| `anonymousGroups` | string[] | `[]` | Groups a *signed-out* visitor is treated as holding. Only meaningful with `publicRead`. |
| `propagateVia` | string[] | `["next"]` | Which metadata relations an access rule is inherited along. Add `"assumes"` to follow prerequisite edges too — a rule then travels from a prerequisite to the pages that assume it, i.e. in reading order, the same direction `next` runs. |

### Declaring groups

`groups` maps a group name to its presentation. The name — the map key — is what
you write in a document's `access` rule and what an administrator ticks in the
accounts panel; it is matched case-insensitively.

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `label` | string | The human-readable name shown in the app. Defaults to the group name. |
| `description` | string | Optional note, shown to administrators. |
| `color` | string | A `#rgb` or `#rrggbb` colour for this group's band on the map. Anything that is not a literal hex colour is ignored — the value reaches the browser and is used in CSS. Omit it and a stable colour is derived from the name. |

A group that is not declared here cannot be assigned to an account, so a typo in
the accounts panel cannot silently create a group nothing grants.

### Sessions, passwords and cookies

| Field | Type | Default | Meaning |
| ----- | ---- | ------- | ------- |
| `usersFile` | string | `.webdoc-auth/users.json` | The account file, relative to the project root. The server refuses to start if it sits inside a served source folder. Keep it out of version control. |
| `sessionIdleMinutes` | int | `480` | Idle timeout. |
| `sessionMaxHours` | int | `720` | Absolute session lifetime. |
| `passwordMinLength` | int | `10` | Minimum password length (never below 8). |
| `pbkdf2Iterations` | int | `210000` | PBKDF2-HMAC-SHA256 cost. Higher is stronger and slower; each sign-in pays it once. |
| `maxLoginFailures` | int | `8` | Failed sign-ins per account before a lockout. The per-address limit is six times this, so one person's typing cannot lock out a whole office. |
| `lockoutSeconds` | int | `300` | How long a lockout lasts. |
| `cookieSecure` | bool | `false` | Marks the session cookie `Secure`. **Set this true whenever the site is served over HTTPS.** |
| `trustedProxies` | string[] | `[]` | Peers whose `X-Forwarded-For` may be believed, for rate limiting. Empty means never — trusting it from anyone would let a caller mint a new identity per guess. |
| `securityHeaders` | bool | `true` | Send `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`. |
| `contentSecurityPolicy` | string | — | Replace the generated CSP wholesale. The default is same-origin only, with a hash for the theme-resolving inline script, so it needs no `unsafe-inline`. |

Sessions live in the server's memory and are never written to disk, so a restart
signs everyone out — the safe default for a documentation server.

## The server

`serve.py` is a static file server written against the Python standard library
only — `http.server`, `json`, `os`, `urllib`, `argparse`, `mimetypes`. There are
no third-party packages to install; any Python 3 interpreter can run it.

Run it from the project root:

```bash
# defaults: reads ./config.json, serves on 127.0.0.1:8000
python serve.py

# choose a port
python serve.py --port 8000

# point at a different config, bind all interfaces
python serve.py --config other.json --host 0.0.0.0
```

The command-line flags:

| Flag | Default | Meaning |
| ---- | ------- | ------- |
| `--config` | `./config.json` | Path to the configuration file. |
| `--host` | `127.0.0.1` | Interface to bind. |
| `--port` | `8000` | TCP port to listen on. |

On start it prints the site title and every mount, e.g.
`mount /docs/Docs/  ->  <folder>`, then serves until interrupted with `Ctrl+C`.

### What the server does and does not do

The server does three things and nothing more:

- Serves the browser app (`app/`) at the web root, forcing correct content types
  so ES modules load even where the OS mis-maps `.js`.
- Answers `GET /site.json` with the resolved configuration — the site title,
  default document, theme, enabled `plugins`, and each source as
  `{ name, url, component, testResults }`, where `testResults` is the resolved
  URL of that source's automated report (or `null`) — which is how the browser
  learns the component for requirement ids, where to fetch automated results, and
  which renderer plugins to load.
- Mounts each source under `/docs/<name>/`. A request for a **file** returns the
  raw bytes; a request for a **directory** returns a JSON listing of its
  entries, which is how the browser discovers documents and builds the tree.

It also accepts two writes, so the app can save without a separate backend:

- `PUT /api/tests/<source>` with a JSON body records that source's manual and run
  results into its hidden `.webdoc-tests.json` sidecar inside the source folder
  (see [Test results](#test-results)), returning `200` on success, `400` if the
  body is not JSON, and `404` for an unknown source.
- `PUT /docs/<source>/<path>.md` with a raw Markdown body writes a document —
  this is how the in-app WYSIWYG editor saves. Only `.md` paths are accepted
  (anything else returns `400`); it returns `201` when it creates a new file and
  `200` when it overwrites an existing one.

To let the library scale to tens of thousands of documents, the server also builds
a lightweight **SQLite index** of each document's metadata, headings, in-body
links, and requirement/test blocks — using standard-library `sqlite3` on a
background thread, cached in a disposable `.webdoc-index/` folder. It exposes
read-only `GET /api/index/…` endpoints (search, the tree, the map graph, coverage,
and link resolution) that the browser uses instead of loading every document at
start-up, and it updates the index incrementally on each save. Crucially the server
still performs **no Markdown rendering**: it extracts only lightweight index data
and never turns a document body into HTML. Parsing, sanitizing, numbering,
highlighting and drawing the map all still happen client-side. See
[Performance & Scale](Docs/reference/performance) for the index and the sizes it
supports.

Requests are path-traversal guarded — a URL cannot escape its source folder — and
dotfiles are omitted from listings.

## Editing configuration

Because the browser reads the configuration from `/site.json` at load time,
changing `config.json` takes effect on the next reload; restart the server if you
changed a source path or component so the new mounts and `/site.json` are picked
up. Adding a document requires no configuration change at all — save the `.md`
file inside a configured source folder and reload. For the shape of that file,
return to the [Authoring Reference](Docs/reference/authoring).
