<!--meta
{ "title": "Get WebDocs Running", "description": "Point the dependency-free server at a folder of Markdown and open the reader.", "assumes": ["Docs/how-to"], "next": ["Docs/how-to/navigating"] }
-->

# Get WebDocs Running

WebDocs is served by a small, dependency-free server that hands the browser the
reader app and your Markdown as-is. Nothing you write has to be compiled — the
engine parses and renders each document in the browser at read time — and the
reader app arrives already built in the release archive, so standing a set up
needs a Python interpreter and nothing more. Download the latest release, unpack
it, and run `python serve.py`. (Working from a git clone instead? The compiled
app is not in version control, so run `npm ci && npm run build` once first.) To
stand up a set of your own:

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

## Serve several projects

Use a `projects` array in `config.json` to give each project its own `name`,
`title`, `sources` and `defaultDoc`. Add an optional `description` string for
the project's start-page card, for example:

```json
{
  "siteTitle": "Team docs",
  "projects": [
    {
      "name": "Guides",
      "title": "Product guides",
      "description": "Setup and everyday use.",
      "defaultDoc": "Guides/overview",
      "sources": [{"name": "Guides", "path": "guides", "component": "GD"}]
    },
    {
      "name": "Engineering",
      "title": "Engineering notes",
      "defaultDoc": "Engineering/overview",
      "sources": [{"name": "Engineering", "path": "engineering", "component": "EN"}]
    }
  ]
}
```

Restart with the updated config, then open the bare site URL to see the project
cards with their page counts. Open a card to read its default page. Click the
project title in the header to switch projects or choose **All projects** to
return to the start page. A single project and old top-level `sources` configs
still open their default document directly. Existing project and hash-only
document bookmarks continue to work. See [Projects](Docs/reference/config#projects)
for naming rules and index locations.
