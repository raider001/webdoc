<!--meta
{ "title": "Get WebDocs Running", "description": "Point the dependency-free server at a folder of Markdown and open the reader.", "assumes": ["Docs/how-to"], "next": ["Docs/how-to/navigating"] }
-->

# Get WebDocs Running

WebDocs is served by a small, dependency-free server that hands the browser the
reader app and your Markdown as-is. Nothing you write has to be compiled — the
engine parses and renders each document in the browser at read time — and the
reader app itself is committed to the repository already built, so standing a set
up needs a Python interpreter and nothing more. To stand up a set of your own:

- Tell the server where your documents live. Each source folder is declared in
  `config.json` with a name and a component id; the name becomes the first
  segment of every document id beneath it.
- Open the app in a browser. WebDocs discovers every `.md` file under each
  source on load, builds the tree, the search index, and the map, and opens the
  default document.
- Add or change a document and reload. Because discovery runs on load, a new
  file joins the set the next time the library loads — no configuration change
  and no restart.

The full list of keys — `sources`, the default document, `plugins`, and
per-source test results — lives in
[the configuration reference](Docs/reference/config).
