<!--meta
{ "title": "Configuration", "description": "config.json sources and components, and the Python static server.", "assumes": ["Docs/reference/authoring"], "next": [] }
-->

# Configuration

WebDocs has exactly one configuration file, `config.json`, and one program that
reads it, `serve.py`. Between them they decide what the site is called, which
folders of Markdown make up the library, what component each folder belongs to,
which document opens first, and the default theme. There is no build step and no
database — the server is a thin static file host, and everything about *how* the
documents render is decided in the browser.

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

Automated test results are configured **per source** with a `testResults` field
on each `sources` entry (see [Sources and components](#sources-and-components)),
not with a top-level key.

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

Crucially, the server performs **no** Markdown parsing, no metadata extraction,
and no rendering. It never reads the body of a `.md` file for meaning — on a read
it just hands the bytes over, and on a write it just stores the opaque bytes.
Discovery, stripping the `<!--meta-->` header, parsing, sanitizing, numbering,
highlighting and drawing the map all happen client-side. That keeps the server
tiny and the whole library effectively static: you could host the same files
behind any static file host and only lose the convenience of the JSON directory
listings and the two write endpoints.

Requests are path-traversal guarded — a URL cannot escape its source folder — and
dotfiles are omitted from listings.

## Editing configuration

Because the browser reads the configuration from `/site.json` at load time,
changing `config.json` takes effect on the next reload; restart the server if you
changed a source path or component so the new mounts and `/site.json` are picked
up. Adding a document requires no configuration change at all — save the `.md`
file inside a configured source folder and reload. For the shape of that file,
return to the [Authoring Reference](Docs/reference/authoring).
