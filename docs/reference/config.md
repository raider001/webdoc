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
    { "name": "Docs", "path": "docs", "component": "WD" }
  ],
  "defaultDoc": "Docs/overview",
  "theme": "auto"
}
```

The fields:

| Field | Type | Default | Meaning |
| ----- | ---- | ------- | ------- |
| `siteTitle` | string | `"Documentation"` | The site name, shown in the header and the browser tab. |
| `sources` | object[] | `[]` | The library: one entry per mounted folder of documents (see below). |
| `defaultDoc` | string | — | The document id opened when no deep-link is present. |
| `theme` | string | `"auto"` | Initial theme: `auto` follows the OS preference; `day` or `night` force a theme. A reader's later choice is remembered and wins over this. |

`theme` only seeds the first paint; see [Theming](Docs/design/theming) for how
the choice is resolved before the page renders so there is no flash.

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

You may list several sources to aggregate multiple folders into one site — for
example a `Docs` guide folder and a separate `API` reference folder, each with
its own component. Names must be unique because they namespace the ids.

### The component feeds requirement ids

`component` is **required** for every source. It is the first segment of every
composed requirement id, `{component}_{group}_{no}`. With component `WD`, a
requirement numbered `1` in a group named `nav` becomes `WD_nav_1`. Authors
never write the component into a document — discovery stamps it onto every
document from the source's configuration, so requirement ids stay consistent
across a whole folder. See [Requirements Traceability](Docs/features/requirements)
for how the composed ids and their traces are built.

If a source is missing a non-empty `component`, the server refuses to start and
prints which source is at fault. This is deliberate: a source with no component
could not compose valid requirement ids, so the failure is loud rather than
silent.

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
  default document, theme, and each source as `{ name, url, component }` — which
  is how the browser learns the component for requirement ids.
- Mounts each source under `/docs/<name>/`. A request for a **file** returns the
  raw bytes; a request for a **directory** returns a JSON listing of its
  entries, which is how the browser discovers documents and builds the tree.

Crucially, the server performs **no** Markdown parsing, no metadata extraction,
and no rendering. It never reads the body of a `.md` file for meaning — it just
hands the bytes over. Discovery, stripping the `<!--meta-->` header, parsing,
sanitizing, numbering, highlighting and drawing the map all happen client-side.
That keeps the server tiny and the whole library effectively static: you could
host the same files behind any static file host and only lose the convenience of
the JSON directory listings.

Requests are path-traversal guarded — a URL cannot escape its source folder — and
dotfiles are omitted from listings.

## Editing configuration

Because the browser reads the configuration from `/site.json` at load time,
changing `config.json` takes effect on the next reload; restart the server if you
changed a source path or component so the new mounts and `/site.json` are picked
up. Adding a document requires no configuration change at all — save the `.md`
file inside a configured source folder and reload. For the shape of that file,
return to the [Authoring Reference](Docs/reference/authoring).
