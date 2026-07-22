#!/usr/bin/env python3
"""Web Document Tool - static server (stdlib only, zero third-party).

Reads config.json, serves the app/ folder at the web root, and mounts every
configured source folder under /docs/<name>/. Directories are returned as a
JSON listing so the browser can discover documents. There is NO build step and
the server performs NO Markdown or metadata parsing - discovery, JSON-metadata
stripping and rendering all happen in the browser.

Usage:
    python serve.py                 # uses ./config.json on 127.0.0.1:8000
    python serve.py --port 9000
    python serve.py --config other.json
"""
import argparse
import json
import mimetypes
import os
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(HERE, "app")

# Force correct content types. Windows' registry sometimes maps .js -> text/plain,
# which breaks ES module loading; be explicit.
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
}


def content_type(path):
    ext = os.path.splitext(path)[1].lower()
    return CONTENT_TYPES.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"


def load_config(path):
    with open(path, encoding="utf-8") as fh:
        cfg = json.load(fh)
    sources = []
    for src in cfg.get("sources", []):
        name = str(src["name"]).strip("/")
        folder = os.path.abspath(os.path.join(HERE, src["path"]))
        if not os.path.isdir(folder):
            print(f"  ! source '{name}' path not found: {folder}")
        # A component id is required per source - it's the first segment of every
        # composed requirement id ({component}_{group}_{no}). Fail loudly if absent.
        component = src.get("component")
        if not component or not str(component).strip():
            raise SystemExit(
                f"config error: source '{name}' is missing a required 'component' name"
            )
        # Optional per-source automated results (xUnit/JUnit). A path relative to
        # the source folder (served under /docs/<name>/) or an absolute served URL.
        sources.append({"name": name, "path": folder, "component": str(component).strip(),
                        "testResults": src.get("testResults")})
    # Renderer plugins are bare file stems loaded from app/thirdpartyrenderer/.
    plugins = cfg.get("plugins", [])
    if not isinstance(plugins, list):
        raise SystemExit("config error: 'plugins' must be a list of plugin names")
    return {
        "siteTitle": cfg.get("siteTitle", "Documentation"),
        "defaultDoc": cfg.get("defaultDoc"),
        "theme": cfg.get("theme", "auto"),
        "testResults": cfg.get("testResults"),
        "plugins": [str(p) for p in plugins],
        "sources": sources,
    }


def safe_join(root, rel):
    """Join rel onto root, refusing to escape root (path-traversal guard)."""
    rel = rel.replace("\\", "/")
    parts = [p for p in rel.split("/") if p not in ("", ".", "..")]
    full = os.path.abspath(os.path.join(root, *parts))
    root_abs = os.path.abspath(root)
    if full != root_abs and not full.startswith(root_abs + os.sep):
        return None
    return full


class DocHandler(BaseHTTPRequestHandler):
    server_version = "WebDocTool/0.1"
    config = None  # attached to the class before serving

    # -- response helpers ---------------------------------------------------
    def _send(self, status, body, ctype="application/octet-stream"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status, obj):
        self._send(status, json.dumps(obj), "application/json; charset=utf-8")

    def _file(self, fspath):
        try:
            with open(fspath, "rb") as fh:
                data = fh.read()
        except OSError:
            return self._json(404, {"error": "not found"})
        self._send(200, data, content_type(fspath))

    def _source(self, name):
        for s in self.config["sources"]:
            if s["name"] == name:
                return s
        return None

    def _listing(self, name, rel, fsdir):
        try:
            names = sorted(os.listdir(fsdir), key=str.lower)
        except OSError:
            return self._json(404, {"error": "not found"})
        entries = []
        for n in names:
            if n.startswith("."):
                continue
            fp = os.path.join(fsdir, n)
            is_dir = os.path.isdir(fp)
            rel_child = (rel + "/" + n).strip("/")
            url = "/docs/" + name + "/" + urllib.parse.quote(rel_child)
            if is_dir:
                url += "/"
            entries.append({"name": n, "type": "dir" if is_dir else "file", "url": url})
        self._json(200, {"type": "dir", "source": name, "path": rel, "entries": entries})

    def _res_url(self, s):
        """Resolve a source's automated-results reference to a fetchable URL. A
        relative path is served from the source mount; an absolute URL passes
        through; falling back to a site-wide `testResults` if the source has none."""
        tr = s.get("testResults") or self.config.get("testResults")
        if not tr:
            return None
        if tr.startswith("/") or "://" in tr:
            return tr
        return "/docs/" + s["name"] + "/" + tr.lstrip("/")

    def _site_json(self):
        cfg = self.config
        self._json(200, {
            "siteTitle": cfg["siteTitle"],
            "defaultDoc": cfg["defaultDoc"],
            "theme": cfg["theme"],
            "plugins": cfg.get("plugins", []),
            "sources": [
                {"name": s["name"], "url": "/docs/" + s["name"] + "/",
                 "component": s["component"], "testResults": self._res_url(s)}
                for s in cfg["sources"]
            ],
        })

    # -- routing ------------------------------------------------------------
    def do_GET(self):
        self.route()

    def do_HEAD(self):
        self.route()

    def route(self):
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if path == "/site.json":
            return self._site_json()
        if path.startswith("/api/tests/"):
            return self._tests_get(path[len("/api/tests/"):])
        if path.startswith("/api/auto/"):
            return self._auto_get(path[len("/api/auto/"):])
        if path.startswith("/api/xml/"):
            return self._xml_list(path[len("/api/xml/"):])
        if path.startswith("/docs/"):
            return self.route_docs(path[len("/docs/"):])
        if path in ("", "/"):
            path = "/index.html"
        fspath = safe_join(APP_DIR, path.lstrip("/"))
        if fspath and os.path.isfile(fspath):
            return self._file(fspath)
        return self._json(404, {"error": "not found", "path": path})

    def route_docs(self, rest):
        rest = rest.strip("/")
        if not rest:
            return self._json(404, {"error": "no source"})
        name, _, rel = rest.partition("/")
        src = self._source(name)
        if not src:
            return self._json(404, {"error": f"unknown source '{name}'"})
        fspath = safe_join(src["path"], rel)
        if not fspath or not os.path.exists(fspath):
            return self._json(404, {"error": "not found"})
        if os.path.isdir(fspath):
            return self._listing(name, rel, fspath)
        return self._file(fspath)

    # -- writing (authoring) ------------------------------------------------
    # Per-source hidden sidecars INSIDE each source folder (dotfiles, omitted from
    # listings): manual/run results, and automated-test connections + remembered
    # xUnit URLs.
    TESTS_FILE = ".webdoc-tests.json"
    AUTO_FILE = ".webdoc-auto.json"

    def _sidecar_path(self, name, filename):
        src = self._source(name.strip("/"))
        return os.path.join(src["path"], filename) if src else None

    def _sidecar_get(self, name, filename):
        fp = self._sidecar_path(name, filename)
        if fp is None:
            return self._json(404, {"error": "unknown source"})
        try:
            with open(fp, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            data = {}
        return self._json(200, data)

    def _sidecar_put(self, name, filename):
        fp = self._sidecar_path(name, filename)
        if fp is None:
            return self._json(404, {"error": "unknown source"})
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length) if length else b"{}"
            obj = json.loads(body.decode("utf-8"))  # validate it's JSON
            with open(fp, "w", encoding="utf-8") as fh:
                json.dump(obj, fh, indent=2)
        except (OSError, ValueError) as e:
            return self._json(400, {"error": str(e)})
        return self._json(200, {"ok": True})

    def _tests_get(self, name):
        return self._sidecar_get(name, self.TESTS_FILE)

    def _tests_put(self, name):
        return self._sidecar_put(name, self.TESTS_FILE)

    def _auto_get(self, name):
        return self._sidecar_get(name, self.AUTO_FILE)

    def _auto_put(self, name):
        return self._sidecar_put(name, self.AUTO_FILE)

    # Every .xml file under a source folder (recursive), as served URLs, so the
    # browser can scan them for xUnit test cases.
    def _xml_list(self, name):
        src = self._source(name.strip("/"))
        if not src:
            return self._json(404, {"error": "unknown source"})
        out = []
        for root, _dirs, files in os.walk(src["path"]):
            for f in files:
                if f.lower().endswith(".xml"):
                    rel = os.path.relpath(os.path.join(root, f), src["path"]).replace("\\", "/")
                    out.append("/docs/" + src["name"] + "/" + urllib.parse.quote(rel))
        out.sort()
        return self._json(200, out)

    def do_PUT(self):
        """Write a document (PUT /docs/<source>/<path>.md, raw Markdown body) or a
        source's results sidecar (PUT /api/tests/<source>, JSON body)."""
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if path.startswith("/api/tests/"):
            return self._tests_put(path[len("/api/tests/"):])
        if path.startswith("/api/auto/"):
            return self._auto_put(path[len("/api/auto/"):])
        if not path.startswith("/docs/"):
            return self._json(405, {"error": "writes are only allowed under /docs/"})
        rest = path[len("/docs/"):].strip("/")
        name, _, rel = rest.partition("/")
        src = self._source(name)
        if not src:
            return self._json(404, {"error": f"unknown source '{name}'"})
        if not rel or not rel.lower().endswith(".md"):
            return self._json(400, {"error": "path must be a .md file"})
        fspath = safe_join(src["path"], rel)
        if not fspath:
            return self._json(400, {"error": "invalid path"})
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length) if length else b""
            existed = os.path.exists(fspath)
            os.makedirs(os.path.dirname(fspath), exist_ok=True)
            with open(fspath, "wb") as fh:
                fh.write(body)
        except (OSError, ValueError) as e:
            return self._json(500, {"error": str(e)})
        doc_id = name + "/" + rel[:-3]  # drop the .md
        return self._json(200 if existed else 201,
                          {"ok": True, "id": doc_id, "created": not existed})

    def log_message(self, fmt, *args):
        print("  %s - %s" % (self.address_string(), fmt % args))


def main():
    ap = argparse.ArgumentParser(description="Web Document Tool static server")
    ap.add_argument("--config", default=os.path.join(HERE, "config.json"))
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    cfg = load_config(args.config)
    DocHandler.config = cfg

    httpd = ThreadingHTTPServer((args.host, args.port), DocHandler)
    print(f"Web Document Tool  -  http://{args.host}:{args.port}")
    print(f"  site: {cfg['siteTitle']}")
    for s in cfg["sources"]:
        print(f"  mount /docs/{s['name']}/  ->  {s['path']}")
    print("  Ctrl+C to stop")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
