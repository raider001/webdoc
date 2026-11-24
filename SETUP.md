# WebDocs — setup and configuration

WebDocs serves a folder of Markdown as a searchable, cross-linked documentation
site with requirements tracing, test coverage, diagrams and an in-browser
editor. This guide takes you from the downloaded archive to a running site
(Part 1), then through everything you can configure (Part 2).

The full manual ships inside the archive as the demo site. Once the server is
running, it is the first thing you see.

---

## Part 1 — Setup

### 1. What you need

- **Python 3.** Releases are tested on Python 3.12. Nothing else is needed: no
  Node.js, no `pip install`, no network access. The server uses the Python
  standard library only.
- **A current browser:** Chrome, Edge, Firefox or Safari.

Check Python is on your path:

```
python --version
```

On Windows the command may be `py` instead of `python`. Use whichever one
prints a version, everywhere this guide says `python`.

### 2. Unpack the archive

| Archive | How to unpack |
| --- | --- |
| `webdoc-v1.0.zip` | Windows: right-click → **Extract All**. macOS/Linux: `unzip webdoc-v1.0.zip` |
| `webdoc-v1.0.tar.gz` | `tar -xzf webdoc-v1.0.tar.gz` |

To check the download first, compare it with the hash in `webdoc-v1.0.sha256`:
run `sha256sum -c webdoc-v1.0.sha256` (Linux/macOS), or
`Get-FileHash webdoc-v1.0.zip` (Windows PowerShell).

Either archive gives you one `webdoc/` folder:

| Path | What it is |
| --- | --- |
| `serve.py`, `webdoc_*.py` | The server. |
| `bootstrap_admin.py` | Creates the first administrator account (see [Accounts](#8-accounts-and-access-groups)). |
| `config.json` | The configuration. It points at the bundled manual until you change it. |
| `app/` | The browser app, already compiled. |
| `app/thirdpartyrenderer/` | Renderer and widget plugins. Diagram libraries you supply go here too. |
| `docs/` | The WebDocs manual, which is also the demo site. |
| `SETUP.md` | This guide. |

### 3. Start the server

```
cd webdoc
python serve.py
```

The server prints the site title and one `mount` line per document folder, and
then listens on **http://127.0.0.1:8000**. It stays in the foreground. Press
`Ctrl+C` to stop it.

### 4. Open the site

Browse to **http://127.0.0.1:8000**. The manual's overview page opens.

On its first start the server builds a search index in `.webdoc-index/`. On
the bundled manual this takes a few seconds. On a library of thousands of
pages it can take a minute or two. The tree, search and the map are complete
once it finishes. To watch it, open `http://127.0.0.1:8000/api/index/status`.
It reports `"state":"ready"` when the index is complete.

If port 8000 is taken, pick another: `python serve.py --port 9000`.

That is the whole install. The rest of this guide is configuration.

---

## Part 2 — Configuration

### 5. How configuration works

There is one file, `config.json`, next to `serve.py`. Use `--config` to point
at a different one:

```
python serve.py --config C:\sites\handbook.json
```

- **Documents never need a restart.** Add, edit or delete a `.md` file and it
  is part of the site on the next page load. Edits made in the browser are
  re-indexed immediately.
- **Configuration changes need a restart.** Stop the server and start it again
  after editing `config.json`.
- **Errors stop the server at start-up** with a `config error:` message that
  names the bad key, so a broken config never half-works.

### 6. Point it at your own documents

Replace `config.json` with your own. A minimal one:

```json
{
  "siteTitle": "Team docs",
  "sources": [
    { "name": "Guide", "path": "C:/work/handbook", "component": "GD" }
  ],
  "defaultDoc": "Guide/overview",
  "plugins": ["mermaid", "software-design", "model-viewer"]
}
```

Each entry in `sources` mounts one folder of Markdown:

| Key | Required | Meaning |
| --- | --- | --- |
| `name` | yes | The folder's namespace: letters, digits, `-` and `_`. It is the first part of every document id, so `C:/work/handbook/setup/install.md` becomes `Guide/setup/install`. Must be unique on the server. |
| `path` | yes | The folder on disk. A relative path is relative to `serve.py`'s folder. An absolute path can be anywhere. |
| `component` | yes | Letters and digits only. It prefixes every requirement id in this folder: `R_GD_INSTALL_1`. The server refuses to start without it. |
| `testResults` | no | This folder's automated xUnit/JUnit report, relative to the folder. See [Test results](#9-test-results-and-test-runs). |
| `runTests` | no | A command readers can start from the page to re-run tests. See [Test results](#9-test-results-and-test-runs). |
| `readOnly` | no | `true` makes this one folder read-only in the browser. |

List several sources to combine folders into one site. Links and requirement
traces work across them.

`defaultDoc` is the id of the page that opens first. Every folder can also act
as a page: WebDocs shows `F.md` next to the folder, or else `F/index.md`, or
else `F/README.md`. A folder with none of these shows a generated listing.

### 7. Top-level keys

| Key | Default | Meaning |
| --- | --- | --- |
| `siteTitle` | `"Documentation"` | Site name on the start page and browser tab. |
| `sources` | `[]` | The document folders (see above). |
| `defaultDoc` | — | First page to open. |
| `projects` | — | Several separate sites on one server (see below). Use either `projects` or top-level `sources`, not both. |
| `plugins` | `[]` | Renderer and widget plugins to load (see [Plugins and widgets](#10-plugins-and-widgets)). |
| `watchIntervalSec` | `3` | How often, in seconds, the server checks for files changed outside the browser. |
| `indexDir` | `.webdoc-index` | Where the disposable search index lives. The `WEBDOC_INDEX_DIR` environment variable overrides it. |
| `auth` | off | Accounts and access groups (see [Accounts](#8-accounts-and-access-groups)). |
| `readOnly` | `false` | Refuse every change, site-wide. `--read-only` on the command line does the same. |
| `allowedHosts` | loopback on the listening port | The `host:port` names browsers may use to reach the server (see [Serving to other people](#11-serving-to-other-people)). |
| `maxDocBodyBytes` | `2097152` | Largest document the editor may save (2 MiB). Accepts up to 16 MiB. |
| `servedOverHttps` | `false` | Set `true` when users reach the site over HTTPS. Enables HSTS. |
| `theme` | `"auto"` | Accepted but currently has no effect. Readers pick light or dark in the app, defaulting to their OS setting. |

#### Several projects on one server

Give each project its own sources, default page and index. With two or more
projects, the bare site URL opens a start page with one card per project.

```json
{
  "siteTitle": "Team docs",
  "plugins": ["mermaid", "model-viewer"],
  "projects": [
    {
      "name": "Guides",
      "title": "Product guides",
      "description": "Setup and everyday use.",
      "defaultDoc": "Guides/overview",
      "sources": [{ "name": "Guides", "path": "C:/work/guides", "component": "GD" }]
    },
    {
      "name": "Platform",
      "title": "Platform programme",
      "defaultDoc": "Platform/overview",
      "sources": [{ "name": "Platform", "path": "C:/work/platform/docs", "component": "PL" }]
    }
  ]
}
```

Project names follow the same rules as source names. Each project gets its own
index folder under `indexDir` unless you give it an `indexDir` of its own.

### 8. Accounts and access groups

Out of the box there are no accounts. **Anyone who can reach the server can
read and edit everything.** That is fine on your own machine. Turn accounts on
before you share the site.

1. Add an `auth` block to `config.json`:

   ```json
   "auth": {
     "enabled": true,
     "allowRegistration": false,
     "publicRead": false,
     "adminGroups": ["admins"],
     "groups": {
       "admins": { "label": "Administrators" },
       "staff":  { "label": "Staff", "color": "#0ea5e9" }
     }
   }
   ```

2. Create the first administrator from a terminal. It asks for the password
   twice and refuses if an administrator already exists:

   ```
   python -B bootstrap_admin.py --config config.json --username admin
   ```

3. Start the server and sign in. Administrators add accounts and assign groups
   from the accounts panel in the app.

4. Lock a page down with an `access` rule in its metadata, for example
   `"access": {"read": ["staff"]}`. The rule also covers the pages that follow it
   (its `next` chain). The bundled manual's **Set up accounts** how-to covers
   rules in detail.

Accounts are stored in `.webdoc-auth/users.json` (change it with
`auth.usersFile`). Keep that folder private and out of version control. It
holds the password hashes. Sessions live in memory, so a restart signs
everyone out.

Other `auth` keys you may want:

| Key | Default | Meaning |
| --- | --- | --- |
| `allowRegistration` | `false` | Let visitors create their own accounts. |
| `requireApproval` | `false` | New registrations stay disabled until an administrator enables them. |
| `publicRead` | `false` | Pages without an access rule can be read without signing in. |
| `defaultGroups` | `[]` | Groups a newly registered account joins. |
| `writeGroups` | `null` | Who may edit unrestricted pages. `null` means any signed-in account. |
| `sessionIdleMinutes` / `sessionMaxHours` | `480` / `720` | Session lifetimes. |
| `passwordMinLength` | `10` | Minimum password length. |
| `cookieSecure` | `false` | **Set `true` when the site is served over HTTPS.** |
| `trustedProxies` | `[]` | Reverse proxies whose `X-Forwarded-For` header is believed. |

The configuration reference in the manual (**Reference → Configuration**)
lists every key.

### 9. Test results and test runs

WebDocs reads requirement and test tables from your documents and shows which
requirements are verified.

**Automated results.** Point a source at the JUnit/xUnit XML your test runner
writes:

```json
{ "name": "Guide", "path": "C:/work/handbook", "component": "GD",
  "testResults": ".results.xml" }
```

A relative path is read from inside the source folder. Each `<testcase>` is
matched to a requirement or test id.

**Manual results** need no configuration. Readers record pass or fail in the
page, and WebDocs stores the results in a hidden `.webdoc-tests.json` inside
each source folder.

**Running tests from the page** (optional). `runTests` gives readers a button
that runs a fixed command and reloads the results:

```json
"runTests": {
  "command": ["C:/tools/python.exe", "run_tests.py", "--output", "{results}"],
  "cwd": "C:/work/handbook-tests",
  "output": "C:/work/handbook-tests/out/units.xml",
  "timeoutSec": 900,
  "env": { "PYTHONDONTWRITEBYTECODE": "1" },
  "cases": ["T_GD_INSTALL_1.1", "T_GD_INSTALL_1.2"]
}
```

- `command` is an argument list containing exactly one `{results}`
  placeholder.
- `cwd` and `output` must be absolute paths.
- `timeoutSec` can be at most 3600.
- `cases` lists the only test ids that may be run.
- `env` is the **entire** environment the command gets. Nothing is inherited
  from the server, so add `PATH` or `SystemRoot` here if your runner needs them.
- The source must also have a `testResults` file.
- `config.json` must not sit inside a document folder.
- Test running works only on a loopback address unless accounts are on.

### 10. Plugins and widgets

Widgets are blocks you insert from **+ Add widget** in the editor. In the
Markdown file each one is a pair of comment markers around ordinary content.

**Built in — always available, nothing to configure:**

| Widget | What it does | Markdown |
| --- | --- | --- |
| Collapsible section | A section readers open and close. | `<!--meta start {"widget":"collapse","title":"Details","open":false}-->` … `<!--meta end {"widget":"collapse"}-->` |
| Auto-update section | Part of another page, refreshed in place. | `<!--meta start {"widget":"live","src":"Guide/status","section":"Running","interval":60}-->` … `<!--meta end {"widget":"live"}-->` |
| Auto-update table | A table from a page, CSV or JSON file, refreshed in place. | `<!--meta start {"widget":"live-table","source":{"kind":"csv","src":"Guide/data/jobs.csv"},"interval":60}-->` … `<!--meta end {"widget":"live-table"}-->` |
| Panel | A framed container. | `<!--meta start {"widget":"panel","title":"Highlights"}-->` … `<!--meta end {"widget":"panel"}-->` |

Widgets can be nested inside one another.

**Plugins — list them in `plugins` to turn them on:**

| Plugin | What it adds | Also needs |
| --- | --- | --- |
| `model-viewer` | Interactive 3D viewer for glTF `.glb` models: orbit, zoom, LOD tabs, embedded animations, PBR textures and a rig test dock for skinned models. | Nothing. It ships complete. |
| `mermaid` | `` ```mermaid `` code fences become pan-and-zoom diagrams. | `mermaid.min.js`, which you supply (see below). |
| `software-design` | UML class, sequence, activity and wireframe diagrams you edit by drawing. | `softwaredesigner.js`, which you supply (see below). |
| `widget-panel` | Older name for the built-in Panel. Keep it only if your config already lists it. | Nothing. |

A **3D model** sits next to your Markdown and is referenced relative to the
page:

```text
<!--meta start {"widget":"model-viewer","src":"./models/rover.glb","title":"Rover"}-->
Drag to orbit, scroll to zoom, Shift+drag to pan, double-click to reset.
<!--meta end {"widget":"model-viewer"}-->
```

Options such as `lods`, `textures`, `height` and `autoRotate` are listed on the
manual's **3D Model Viewer** page.

**Supplying a diagram library.** WebDocs does not redistribute other projects'
libraries, so these two plugins look for a file you place in
`app/thirdpartyrenderer/`:

- **Mermaid:** download `mermaid.min.js` (from the `mermaid` package on npm,
  file `dist/mermaid.min.js`) and save it as
  `app/thirdpartyrenderer/mermaid.min.js`.
- **Software Designer:** build its embeddable bundle (`npm run build:embed` in
  the Software Designer repository) and copy `dist-embed/softwaredesigner.js` to
  `app/thirdpartyrenderer/softwaredesigner.js`.

Until the file is there, the block shows its source text with a short notice.
The rest of the page works normally.

**Your own widgets.** Any `app/thirdpartyrenderer/<name>.js` that registers a
widget can be listed in `plugins`. The manual's **Add a widget plugin** how-to
and **Widget API** page show how. Only install plugin code you trust: it runs in
your readers' browsers.

### 11. Serving to other people

By default the server listens on `127.0.0.1` only, so other machines cannot
reach it. To share it:

1. **Turn on accounts** ([section 8](#8-accounts-and-access-groups)), or run
   read-only (`"readOnly": true` or `--read-only`).
2. **Bind a reachable interface:** `python serve.py --host 0.0.0.0 --port 8000`.
3. **List the names browsers will use** in `allowedHosts`. Requests for any
   other `Host` are refused:

   ```json
   "allowedHosts": ["docs.example.com:443", "docs-server:8000"]
   ```

4. **Put HTTPS in front.** The server speaks plain HTTP. Run it behind a
   reverse proxy (nginx, Caddy, IIS) that terminates TLS. Then set
   `"servedOverHttps": true`, `"auth": { "cookieSecure": true, ... }` and, if the
   proxy is on another machine, `"trustedProxies": ["<proxy address>"]`.

To keep it running after you log out, run it as a service: a systemd unit on
Linux, or a scheduled task or NSSM service on Windows. Use the same command
line you tested by hand.

### 12. Command-line reference

| Flag | Default | Meaning |
| --- | --- | --- |
| `--config PATH` | `config.json` next to `serve.py` | Configuration file to use. |
| `--host ADDR` | `127.0.0.1` | Interface to listen on. |
| `--port N` | `8000` | Port to listen on. |
| `--read-only` | off | Refuse every change. Same as `"readOnly": true`. |

### 13. Files WebDocs writes

| Path | What | Safe to delete? |
| --- | --- | --- |
| `.webdoc-index/` | Search index and cached metadata. | Yes. It rebuilds on the next start. |
| `.webdoc-auth/users.json` | Accounts and password hashes. | No. Back it up and keep it private. |
| `<source>/.webdoc-tests.json` | Manual test results for that folder. | No. It travels with your documents. |

WebDocs changes your Markdown only when someone edits, moves or deletes a page
in the browser.

### 14. Upgrading

1. Unpack the new release into a new folder.
2. Copy across your `config.json` and `.webdoc-auth/`, plus any libraries
   you added to `app/thirdpartyrenderer/` (`mermaid.min.js`,
   `softwaredesigner.js`, plugins of your own).
3. Stop the old server and start the new one. The index rebuilds itself if its
   format changed.

Your documents live outside the release folder, so they are not touched.

### 15. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `config error: …` at start-up | The message names the key. Fix it and start again. |
| `source '…' path not found` | The `path` does not exist. Relative paths are relative to `serve.py`'s folder. |
| Address already in use | Another program has the port. Use `--port`. |
| `{"error": "host refused"}` (403) when opening the site by another name or from another machine | Add the exact `host:port` you typed to `allowedHosts`. |
| Diagrams show as code | The plugin is not in `plugins`, or its library file is missing from `app/thirdpartyrenderer/`. |
| A 3D model does not load | The `.glb` must be inside a source folder, and `src` is relative to the page. |
| Search or the map is empty | The index is still building. Check `/api/index/status`. |
| Signed out after a restart | Expected. Sessions are kept in memory. |

For everything else, read the manual that ships in `docs/`. It is served at
the site root whenever `config.json` points at it.
