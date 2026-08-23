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
import base64
import gzip
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import webdoc_access
import webdoc_auth

try:
    import webdoc_index
except Exception:                  # the index is optional; the ACL check is not
    webdoc_index = None

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(HERE, "app")

# Request body ceilings. Without these a single request can pin an arbitrary
# amount of memory, and the JSON APIs have no business receiving megabytes.
MAX_DOC_BODY = 8 * 1024 * 1024
MAX_JSON_BODY = 1 * 1024 * 1024
MAX_AUTH_BODY = 16 * 1024


class _Refused(Exception):
    """A policy refusal raised deep in a handler and turned into a 400 by the
    dispatcher, so guard code can bail out without threading a return value back
    through every caller."""

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


# Which static bodies are worth gzipping. Text-shaped payloads - JS, CSS, HTML,
# JSON, SVG, Markdown, plain text - shrink 3-5x, and the app ships ~600 kB of
# uncompressed JavaScript on a cold load, so this is the largest single win the
# server has. PNG/JPEG/GIF/WebP/ICO/WOFF2 are ALREADY compressed: re-gzipping
# them burns CPU and typically makes the body a few bytes LARGER, so they go out
# verbatim. The test is on the media type, not the extension, so anything
# mimetypes guesses is classified by the same rule.
GZIP_TYPES = {
    "application/javascript", "application/json", "application/xml",
    "image/svg+xml",
}

# Below one TCP segment the body already arrives in a single packet, so
# compressing it cannot save a round trip - meanwhile gzip's ~20 bytes of header
# and trailer plus the Content-Encoding and Vary header lines can leave the
# response LARGER than it started. 1400 is the number _json already uses (just
# under the 1460-byte payload of a 1500-byte-MTU segment): one threshold, one
# rule, nothing new to keep in sync.
GZIP_MIN_BYTES = 1400


def gzippable(ctype):
    """Whether a response of this content type benefits from compression."""
    base = (ctype or "").split(";", 1)[0].strip().lower()
    return base.startswith("text/") or base in GZIP_TYPES


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
    # Accounts + access groups. Absent or "enabled": false means the server behaves
    # exactly as it always has: no sign-in, anonymous read AND write.
    auth = webdoc_auth.AuthConfig(cfg.get("auth"), HERE)
    # Which meta relations an access lock is inherited along. "next" (Recommended
    # next) is the default; add "assumes" to follow prerequisite edges too.
    propagate_via = cfg.get("auth", {}).get("propagateVia") if isinstance(cfg.get("auth"), dict) else None
    if not isinstance(propagate_via, list):
        propagate_via = ["next"]
    # The account file must never be reachable through a source mount, however the
    # operator has arranged their folders.
    if _within(auth.auth_dir, APP_DIR) or _within(APP_DIR, auth.auth_dir):
        raise SystemExit(
            "config error: the auth folder %s overlaps the served app folder %s; "
            "move usersFile somewhere neither is served" % (auth.auth_dir, APP_DIR))
    for src in sources:
        if _within(auth.auth_dir, src["path"]) or _within(src["path"], auth.auth_dir):
            raise SystemExit(
                "config error: the auth folder %s overlaps the source '%s' (%s); "
                "move usersFile outside every served source" % (auth.auth_dir, src["name"], src["path"]))
    return {
        "siteTitle": cfg.get("siteTitle", "Documentation"),
        "defaultDoc": cfg.get("defaultDoc"),
        "theme": cfg.get("theme", "auto"),
        "testResults": cfg.get("testResults"),
        "plugins": [str(p) for p in plugins],
        "indexBody": bool(cfg.get("indexBody", False)),
        "indexDir": cfg.get("indexDir"),
        # Seconds between background filesystem re-scans that pick up .md files
        # added/edited/removed OUTSIDE the app (a text editor, git, etc). 0/false
        # disables the watcher; the app's own writes (PUT/DELETE) stay instant
        # regardless, since those already call index.update_doc/delete_doc directly.
        "watchIntervalSec": cfg.get("watchIntervalSec", 3),
        "sources": sources,
        "auth": auth,
        "propagateVia": [str(p) for p in propagate_via],
    }


# Characters and shapes Windows silently normalises away, which is what makes
# them dangerous: `page.md.` and `page.md::$DATA` both OPEN page.md, but neither
# ENDS in ".md", so a routing decision made on the URL text sends them down the
# non-Markdown branch - past document redaction and onto the looser asset rule.
# Rejecting the spellings outright is simpler and safer than trying to normalise
# them, and none of them is a filename anyone can create on Windows anyway.
_HOSTILE_CHARS = re.compile(r'[<>:"|?*\x00-\x1f]')


def safe_join(root, rel):
    """Join rel onto root, refusing to escape root (path-traversal guard) and
    refusing any path component that a filesystem would silently rewrite."""
    rel = rel.replace("\\", "/")
    parts = [p for p in rel.split("/") if p not in ("", ".", "..")]
    for part in parts:
        if _HOSTILE_CHARS.search(part) or part != part.rstrip(" ."):
            return None
    full = os.path.abspath(os.path.join(root, *parts))
    root_abs = os.path.abspath(root)
    if full != root_abs and not full.startswith(root_abs + os.sep):
        return None
    return full


def _as_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _within(inner, outer):
    """True when `inner` is `outer` or sits underneath it."""
    a, b = os.path.abspath(inner), os.path.abspath(outer)
    return a == b or a.startswith(b + os.sep)


def _inline_script_hashes(html_path):
    """CSP hashes for the inline <script> blocks in app/index.html.

    The app resolves the colour theme in an inline script so the first paint is
    never the wrong theme. Hashing it keeps 'unsafe-inline' out of the policy
    instead of trading that guarantee away.
    """
    try:
        with open(html_path, encoding="utf-8") as fh:
            html = fh.read()
    except OSError:
        return []
    out = []
    for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S | re.I):
        digest = hashlib.sha256(m.group(1).encode("utf-8")).digest()
        out.append("'sha256-%s'" % base64.b64encode(digest).decode("ascii"))
    return out


class DocHandler(BaseHTTPRequestHandler):
    # A connection that stops talking must not pin a worker thread forever: one
    # client announcing a large body and then going silent would otherwise hold a
    # thread indefinitely, and enough of them would hold all of them.
    timeout = 30

    server_version = "WebDocTool/0.1"
    protocol_version = "HTTP/1.0"   # one request per connection; no keep-alive framing to get wrong
    config = None  # attached to the class before serving
    index = None   # webdoc_index.Index, attached before serving (None if disabled)
    users = None      # webdoc_auth.UserStore  (None when auth is disabled)
    sessions = None   # webdoc_auth.SessionStore
    # Document writes are serialised. The window between "may they write this?"
    # and the write itself is small but real, and an interleaved pair of PUTs can
    # land a body that no check ever approved. Writes are rare; a single lock is
    # the honest fix.
    write_lock = threading.Lock()
    login_limiter = None      # strict, per ACCOUNT
    ip_limiter = None         # loose, per SOURCE ADDRESS (a proxy is one address)
    register_limiter = None
    csp = None        # the Content-Security-Policy header value, built at start-up

    # ---- per-request identity ---------------------------------------------
    def _begin(self):
        """Resolve who is calling, once per request, before any routing.

        Sets self.principal (never None), self.session (the live session record or
        None) and self.gate (the single object every access decision goes through).
        """
        self._extra_cookies = []
        self._asset_cache = {}      # folder -> readable, memoised for this request
        cfg = self.config["auth"]
        self.principal = webdoc_auth.anonymous_principal(cfg)
        self.session = None
        if cfg.enabled and self.sessions is not None:
            cookies = webdoc_auth.parse_cookies(self.headers.get("Cookie"))
            # A background poll is not activity. The app asks for the index status
            # every few seconds; counting that as a touch made sessionIdleMinutes
            # unreachable for as long as a tab stayed open.
            path_now = urllib.parse.urlparse(self.path).path
            touch = not path_now.startswith("/api/index/status")
            sess = self.sessions.get(cookies.get(webdoc_auth.SESSION_COOKIE), touch=touch)
            if sess:
                rec = self.users.get(sess["username"]) if self.users else None
                if rec and not rec.get("disabled"):
                    self.principal = webdoc_auth.make_principal(cfg, rec)
                    self.session = sess
                else:
                    # The account vanished or was disabled mid-session: drop it.
                    self.sessions.destroy_user(sess["username"])
        # The ACL map is authoritative only once the index has finished building.
        # While it is building - or if it failed outright - an empty map must NOT
        # read as "nothing is restricted", so the gate is marked not-ready and
        # every document request answers 503 instead of handing out the file.
        ready = bool(self.index) and self.index.state == "ready"
        acl = self.index.access_map() if (cfg.enabled and ready) else {}
        self.gate = webdoc_access.Gate(cfg, self.principal, acl, ready=ready or not cfg.enabled)

    def _client_ip(self):
        """The address to rate-limit against.

        X-Forwarded-For is believed ONLY when the peer is a configured trusted
        proxy - otherwise any caller could forge a fresh identity for every login
        attempt and walk straight past the limiter. With no proxy configured,
        everyone behind one shares a bucket, which is why the per-IP threshold is
        deliberately looser than the per-account one.
        """
        try:
            peer = self.client_address[0]
        except Exception:
            return "?"
        cfg = self.config["auth"]
        if peer in cfg.trusted_proxies:
            fwd = self.headers.get("X-Forwarded-For")
            if fwd:
                # Right-most hop is the one this trusted proxy actually saw.
                hop = fwd.split(",")[-1].strip()
                if hop and len(hop) <= 64:
                    return hop
        return peer

    # -- response helpers ---------------------------------------------------
    def _security_headers(self):
        cfg = self.config["auth"]
        if not cfg.security_headers:
            return
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("X-Frame-Options", "DENY")
        if self.csp:
            self.send_header("Content-Security-Policy", self.csp)

    def _emit_headers(self, status, ctype, length, extra=()):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self._security_headers()
        for name, value in extra:
            self.send_header(name, value)
        for cookie in getattr(self, "_extra_cookies", ()):
            self.send_header("Set-Cookie", cookie)
        self.end_headers()

    # _send / _json return True - "a response has been sent". That makes
    # `return self._json(...)` compose inside a guard: a guard can answer the
    # request AND report that it did, in one statement. Without it a guard's
    # refusal is indistinguishable from its approval (both None) and the caller
    # carries on doing the thing it just refused.
    def _send(self, status, body, ctype="application/octet-stream", extra=()):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self._emit_headers(status, ctype, len(body), extra)
        if self.command != "HEAD":
            self.wfile.write(body)
        return True

    def _json(self, status, obj, extra=()):
        body = json.dumps(obj, separators=(",", ":")).encode("utf-8")
        # gzip large index payloads (the whole-graph payload is multi-MB at scale)
        # when the client accepts it - stdlib gzip, no dependency.
        if len(body) > 1400 and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            body = gzip.compress(body, 5)
            self._emit_headers(status, "application/json; charset=utf-8", len(body),
                               list(extra) + [("Content-Encoding", "gzip")])
            if self.command != "HEAD":
                self.wfile.write(body)
            return True
        return self._send(status, body, "application/json; charset=utf-8", extra)

    def _send_static(self, status, body, ctype, extra=()):
        """Send bytes read off disk, gzipped when that is allowed AND worthwhile.

        Only the ENCODING changes here - the bytes the client ends up holding are
        the same bytes either way.

        Vary: Accept-Encoding goes on EVERY compressible response, compressed or
        not. A cache that stored the plain copy must not hand it to a client that
        asked for gzip, and - the half that actually breaks - must not hand the
        gzipped copy to a client that never offered gzip and will render it as
        binary soup. The response is negotiated on that header, so it has to say
        so whichever branch it took. Incompressible types (PNG, WOFF2) never
        vary, so they do not carry it.
        """
        if not gzippable(ctype):
            return self._send(status, body, ctype, extra)
        extra = list(extra) + [("Vary", "Accept-Encoding")]
        # No Accept-Encoding means "identity only", not "probably fine" - the
        # same substring test _json uses, so there is one gzip rule in this file.
        if len(body) >= GZIP_MIN_BYTES and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            body = gzip.compress(body, 5)
            extra.append(("Content-Encoding", "gzip"))
        # _send measures the body it is about to write, so Content-Length is the
        # COMPRESSED length for free, and HEAD (which routes through here exactly
        # like GET) still advertises what a GET would return while writing no
        # body. Range requests are not a concern: this server has never served a
        # 206 or advertised Accept-Ranges, so there is no partial response for
        # compression to misalign.
        return self._send(status, body, ctype, extra)

    def _set_cookie(self, cookie):
        self._extra_cookies.append(cookie)

    # -- standard refusals ---------------------------------------------------
    def _deny(self, eff=None, what="document"):
        """403 with the groups that WOULD open it - the map shows a locked page
        exists, so naming its groups tells the reader who to ask, and reveals
        nothing they could not already see."""
        groups = sorted((eff or {}).get("read") or ()) if eff else []
        groups = [g for g in groups if g not in webdoc_access.UNPARSABLE]
        return self._json(403, {"error": "restricted", "what": what,
                                "requiresGroups": groups,
                                "authenticated": self.principal.authenticated,
                                "signInRequired": not self.principal.authenticated})

    def _not_found(self):
        """404 for anything hidden. A hidden document must be indistinguishable
        from one that does not exist, so this is the ONLY response it ever gets."""
        return self._json(404, {"error": "not found"})

    def _not_ready(self):
        """503 while the ACL map is unknown. Serving the document anyway would be
        the bypass; pretending it is missing would be a lie the client caches."""
        status = self.index.status() if self.index else {"state": "disabled"}
        return self._json(503, {"error": "index building", "status": status},
                          extra=[("Retry-After", "2")])

    def _acl_blocked(self):
        """True when access decisions cannot be made yet and this caller is not an
        administrator."""
        return (self.config["auth"].enabled and not self.gate.ready
                and not self.principal.admin)

    def _doc_id_for(self, src, fspath):
        """The canonical index id for a file, derived from the RESOLVED filesystem
        path rather than the URL.

        Building it from the URL was a complete bypass: `/docs/Docs/./ref/cfg.md`
        and `/docs/Docs/REF/CFG.md` both open the same file, but produce ids no
        ACL is stored under - so the lookup came back "unrestricted" and the file
        was served. relpath collapses `.` and `..`, and canonical_id fixes the
        casing against what the index actually stored.
        """
        rel = os.path.relpath(fspath, src["path"]).replace("\\", "/")
        doc_id = src["name"] + "/" + re.sub(r"\.md$", "", rel, flags=re.I)
        if self.index:
            canon = self.index.canonical_id(doc_id)
            if canon:
                return canon
        return doc_id

    # -- request bodies ------------------------------------------------------
    def _read_body(self, limit):
        """-> bytes, or None if the request is unacceptable.

        Rejects chunked transfer encoding and duplicated Content-Length outright:
        this server does not decode chunked bodies, so accepting the header would
        leave undrained bytes in the socket for the next parse to pick up.
        """
        if self.headers.get("Transfer-Encoding"):
            return None
        lengths = self.headers.get_all("Content-Length") or []
        if len(lengths) > 1:
            return None
        try:
            length = int(lengths[0]) if lengths else 0
        except (TypeError, ValueError):
            return None
        if length < 0:
            return None
        if length > limit:
            # Drain (and discard) what the client is still sending, up to a hard
            # cap, so the refusal actually reaches them. Answering and hanging up
            # mid-upload just gives the caller a connection reset and no reason.
            self._drain(min(length, 32 * 1024 * 1024))
            return None
        if not length:
            return b""
        data = self.rfile.read(length)
        return data if len(data) == length else None

    def _drain(self, count):
        """Discard up to `count` bytes of an unwanted body, giving up on a stall.
        Bounded by the handler socket timeout, so a client that stops sending
        halfway costs one timeout, not a permanently parked thread."""
        left = count
        try:
            while left > 0:
                chunk = self.rfile.read(min(65536, left))
                if not chunk:
                    break
                left -= len(chunk)
        except OSError:
            pass

    def _read_json(self, limit=MAX_JSON_BODY):
        raw = self._read_body(limit)
        if raw is None:
            return None
        try:
            obj = json.loads(raw.decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            return None
        return obj if isinstance(obj, dict) else None

    # -- CSRF / origin -------------------------------------------------------
    def _same_origin(self):
        """Reject a state-changing request whose Origin names a different site.
        Belt to the SameSite cookie's braces - and the check that still holds if a
        browser ever relaxes SameSite defaults."""
        origin = self.headers.get("Origin")
        if not origin or origin == "null":
            return True                       # non-browser client, or same-origin navigation
        host = (self.headers.get("Host") or "").strip()
        try:
            parsed = urllib.parse.urlparse(origin)
        except ValueError:
            return False
        return bool(parsed.netloc) and parsed.netloc == host

    def _csrf_ok(self):
        """Double-submit: the X-WebDoc-CSRF header must match the wd_csrf cookie,
        and (once signed in) the token the session was issued.

        A cross-site page can neither read our SameSite=Strict cookie nor set a
        custom header without a CORS preflight we never answer, so a forged
        request fails both halves.
        """
        if not self.config["auth"].enabled:
            return True
        sent = self.headers.get(webdoc_auth.CSRF_HEADER)
        if not sent:
            return False
        cookies = webdoc_auth.parse_cookies(self.headers.get("Cookie"))
        cookie_token = cookies.get(webdoc_auth.CSRF_COOKIE) or ""
        if not cookie_token or not hmac.compare_digest(str(sent), str(cookie_token)):
            return False
        if self.session and not hmac.compare_digest(str(sent), str(self.session["csrf"])):
            return False
        return True

    def _guard_mutation(self):
        """Every unsafe method funnels through here. -> True when it may proceed."""
        if not self._same_origin():
            self._json(403, {"error": "cross-origin request refused"})
            return False
        if not self._csrf_ok():
            self._json(403, {"error": "missing or invalid CSRF token", "csrf": True})
            return False
        return True

    def _index_route(self, rest):
        idx = self.index
        if idx is None:
            return self._json(503, {"error": "index disabled"})
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        first = rest.strip("/").split("/", 1)[0]
        if first == "status":
            st = idx.status()
            if not self._readable_site():
                # Boot needs state/pct to show the index-build progress bar; the
                # document count is library data and waits for a sign-in.
                st = {"state": st["state"], "pct": st["pct"], "generation": st["generation"], "docs": 0}
            return self._json(200, st)
        if idx.state != "ready":
            return self._json(503, {"error": "index building", "status": idx.status()})
        # Everything below returns document data, so it is behind the sign-in wall
        # whenever one is configured.
        if not self._readable_site():
            return self._deny(what="library")
        if self._acl_blocked():
            return self._not_ready()
        gate = self.gate
        if first == "search":
            q = (qs.get("q") or [""])[0]
            limit = max(0, min(200, _as_int((qs.get("limit") or ["50"])[0], 50)))
            offset = max(0, min(10000, _as_int((qs.get("offset") or ["0"])[0], 0)))
            return self._json(200, {"results": idx.search(q, limit, offset, gate)})
        if first == "tree":
            return self._json(200, idx.tree((qs.get("path") or [""])[0], gate))
        if first == "resolve":   # batch-resolve in-body link targets -> doc ids
            paths = (qs.get("p") or [])[:100]
            return self._json(200, {"resolved": idx.resolve((qs.get("base") or [""])[0], paths, gate)})
        if first == "graph":
            return self._json(200, idx.graph(gate))
        if first == "coverage":
            return self._json(200, idx.coverage(gate))
        if first == "access":    # effective + declared ACL for one document
            return self._access_info((qs.get("id") or [""])[0])
        return self._json(404, {"error": "unknown index endpoint"})

    def _readable_site(self):
        """Whether this caller may see ANY document data at all: signed in, or the
        library is configured as publicly readable."""
        cfg = self.config["auth"]
        return (not cfg.enabled) or self.principal.authenticated or cfg.public_read

    def _access_info(self, doc_id):
        """What the editor's access panel needs: this document's declared block,
        its effective (possibly inherited) ACL, and whether this user may change it."""
        cfg = self.config["auth"]
        if not doc_id:
            return self._json(400, {"error": "id required"})
        canon = self.index.canonical_id(doc_id) if self.index else None
        # A hidden document and a nonexistent one must answer identically, or the
        # difference between 404 and 200 becomes an oracle for enumerating hidden ids.
        if not canon or self.gate.is_hidden(canon):
            return self._not_found()
        doc_id = canon
        eff = self.gate.eff(doc_id)
        # How many sections of THIS document are withheld from this reader. A
        # document with any is read-only for them (saving it would overwrite the
        # withheld sections), so the editor needs to know before offering an Edit
        # button that could only ever fail.
        redacted = self._redacted_count(doc_id)
        return self._json(200, {
            "id": doc_id,
            "declared": self.index.declared_access(doc_id) if self.index else None,
            "redactedSections": redacted,
            "effective": {
                "read": list(eff.get("read") or []) if eff.get("read") is not None else None,
                "write": list(eff.get("write") or []) if eff.get("write") is not None else None,
                "hidden": bool(eff.get("hidden")),
                "explicit": bool(eff.get("explicit")),
                "inheritedFrom": list(eff.get("inheritedFrom") or ()),
            },
            "canRead": self.gate.can_read(doc_id),
            "canWrite": self.gate.can_write(doc_id),
            "canEditAccess": webdoc_access.can_edit_acl(cfg, self.principal),
            "knownGroups": sorted(set(cfg.known_groups()) | set(self.index.access_groups() if self.index else [])),
        })

    def _redacted_count(self, doc_id):
        """How many sections of one document this caller would not be served."""
        cfg = self.config["auth"]
        if not cfg.enabled or self.principal.admin:
            return 0
        source, _, rel = str(doc_id).partition("/")
        src = self._source(source)
        if not src or not rel:
            return 0
        fspath = safe_join(src["path"], rel + ".md")
        if not fspath or not os.path.isfile(fspath):
            return 0
        try:
            with open(fspath, encoding="utf-8-sig") as fh:
                text = fh.read()
        except OSError:
            return 0
        return webdoc_access.redact_sections(cfg, self.principal, text)[1]

    # ---- authentication API ------------------------------------------------
    def _auth_route_get(self, rest):
        cfg = self.config["auth"]
        first = rest.strip("/").split("/", 1)[0]
        if first == "me":
            return self._auth_me()
        if first == "users":
            if not (cfg.enabled and self.principal.admin):
                return self._json(403, {"error": "administrators only"})
            return self._json(200, {"users": self.users.list_users(),
                                    "groups": [cfg.groups[k] for k in sorted(cfg.groups)]})
        return self._json(404, {"error": "unknown auth endpoint"})

    def _auth_me(self):
        """Identity + the CSRF token this browser must echo on every write.

        Also the ONLY place a wd_csrf cookie is minted, so the client can call it
        once at boot and be able to write from then on.
        """
        cfg = self.config["auth"]
        csrf = self.session["csrf"] if self.session else None
        if cfg.enabled and not csrf:
            # Anonymous callers still need a token: sign-in and registration are
            # themselves state-changing and must not be forgeable cross-site.
            cookies = webdoc_auth.parse_cookies(self.headers.get("Cookie"))
            # Reuse the caller's token only if it LOOKS like one we issued. It is
            # attacker-controlled and about to be written into a Set-Cookie header,
            # where a stray ";" would inject cookie attributes.
            csrf = cookies.get(webdoc_auth.CSRF_COOKIE) or ""
            if not webdoc_auth.TOKEN_RE.match(csrf):
                csrf = secrets.token_urlsafe(32)
        if cfg.enabled:
            self._set_cookie(webdoc_auth.cookie_header(
                webdoc_auth.CSRF_COOKIE, csrf, http_only=False, secure=cfg.cookie_secure,
                max_age=cfg.session_max_hours * 3600))
        return self._json(200, {
            "auth": cfg.to_json(),
            "user": self.principal.to_json() if self.principal.authenticated else None,
            "csrf": csrf,
            "canWrite": webdoc_access.can_write(cfg, self.principal, webdoc_access.UNRESTRICTED),
            "canEditAccess": webdoc_access.can_edit_acl(cfg, self.principal),
            "needsBootstrap": bool(cfg.enabled and self.users is not None
                                   and self.users.count() == 0 and cfg.allow_registration),
        })

    def _auth_route_post(self, rest):
        cfg = self.config["auth"]
        if not cfg.enabled:
            return self._json(404, {"error": "accounts are disabled on this server"})
        first = rest.strip("/").split("/", 1)[0]
        if first == "login":
            return self._auth_login()
        if first == "logout":
            return self._auth_logout()
        if first == "register":
            return self._auth_register()
        if first == "password":
            return self._auth_change_password()
        if first == "users":
            return self._auth_admin_users(rest.strip("/").split("/")[1:])
        return self._json(404, {"error": "unknown auth endpoint"})

    def _auth_login(self):
        cfg = self.config["auth"]
        body = self._read_json(MAX_AUTH_BODY)
        if body is None:
            return self._json(400, {"error": "invalid request"})
        username = str(body.get("username") or "")
        password = str(body.get("password") or "")
        ip = self._client_ip()
        user_key = webdoc_auth.normalize_username(username)
        # Two limiters with different jobs. Per-ACCOUNT is strict: it stops many
        # hosts hammering one password. Per-ADDRESS is loose: it stops one host
        # spraying many accounts, but must not lock a whole office (or everyone
        # behind a reverse proxy) out because one colleague fat-fingered a login.
        wait = self.login_limiter.retry_after("user:" + user_key) or self.ip_limiter.retry_after("ip:" + ip)
        if wait:
            return self._json(429, {"error": "Too many attempts. Try again in %d seconds." % wait,
                                    "retryAfter": wait}, extra=[("Retry-After", str(wait))])
        rec, reason = self.users.verify(username, password)
        if not rec:
            self.ip_limiter.fail("ip:" + ip)
            self.login_limiter.fail("user:" + user_key)
            if reason == "disabled":
                return self._json(403, {"error": "That account is awaiting approval or has been disabled."})
            # One message for "no such user" and "wrong password": the pair is what
            # turns a login form into an account-enumeration oracle.
            return self._json(401, {"error": "Incorrect username or password."})
        # Only the ACCOUNT bucket is cleared. Clearing the address bucket would let
        # anyone holding one valid credential reset it between guesses and spray
        # every other account without limit.
        self.login_limiter.reset("user:" + user_key)
        return self._start_session(rec)

    def _start_session(self, rec):
        """Issue a brand-new session (and CSRF token) - never reuse an existing
        one, so a token planted before sign-in cannot be ridden afterwards."""
        cfg = self.config["auth"]
        old = webdoc_auth.parse_cookies(self.headers.get("Cookie")).get(webdoc_auth.SESSION_COOKIE)
        if old:
            self.sessions.destroy(old)
        token, csrf = self.sessions.create(rec["username"])
        self.users.touch_login(rec["username"])
        self._set_cookie(webdoc_auth.cookie_header(
            webdoc_auth.SESSION_COOKIE, token, http_only=True, secure=cfg.cookie_secure,
            max_age=cfg.session_max_hours * 3600))
        self._set_cookie(webdoc_auth.cookie_header(
            webdoc_auth.CSRF_COOKIE, csrf, http_only=False, secure=cfg.cookie_secure,
            max_age=cfg.session_max_hours * 3600))
        principal = webdoc_auth.make_principal(cfg, rec)
        return self._json(200, {"ok": True, "user": principal.to_json(), "csrf": csrf})

    def _auth_logout(self):
        cfg = self.config["auth"]
        token = webdoc_auth.parse_cookies(self.headers.get("Cookie")).get(webdoc_auth.SESSION_COOKIE)
        if token:
            self.sessions.destroy(token)
        self._set_cookie(webdoc_auth.clear_cookie_header(webdoc_auth.SESSION_COOKIE, secure=cfg.cookie_secure))
        self._set_cookie(webdoc_auth.clear_cookie_header(webdoc_auth.CSRF_COOKIE, secure=cfg.cookie_secure,
                                                         http_only=False))
        return self._json(200, {"ok": True})

    def _auth_register(self):
        cfg = self.config["auth"]
        if not cfg.allow_registration:
            return self._json(403, {"error": "Registration is closed on this server."})
        body = self._read_json(MAX_AUTH_BODY)
        if body is None:
            return self._json(400, {"error": "invalid request"})
        ip = self._client_ip()
        wait = self.register_limiter.retry_after("ip:" + ip)
        if wait:
            return self._json(429, {"error": "Too many attempts. Try again in %d seconds." % wait,
                                    "retryAfter": wait}, extra=[("Retry-After", str(wait))])
        username = str(body.get("username") or "").strip()
        password = str(body.get("password") or "")
        display = body.get("displayName")
        ok, msg = webdoc_auth.validate_username(username)
        if not ok:
            self.register_limiter.fail("ip:" + ip)
            return self._json(400, {"error": msg})
        ok, msg = webdoc_auth.validate_password(password, cfg.password_min_length)
        if not ok:
            return self._json(400, {"error": msg})
        # Bootstrap: the very first account on an empty server becomes the
        # administrator, because otherwise a fresh install has nobody who can grant
        # anyone anything. Every later account follows the configured defaults.
        # Whether this is the first account is decided INSIDE the store lock
        # (first_only_admin), not out here: two concurrent registrations on an
        # empty server both read count()==0 and both became administrators.
        first = self.users.count() == 0
        disabled = bool(cfg.require_approval and not first)
        rec, err = self.users.create(username, password, display,
                                     groups=cfg.default_groups, disabled=disabled,
                                     first_only_admin=cfg.first_user_is_admin)
        is_admin = bool(rec and rec.get("admin"))
        if err:
            self.register_limiter.fail("ip:" + ip)
            return self._json(409, {"error": err})
        # Successful registrations count against the limiter as well: only
        # counting failures left anonymous account creation effectively unbounded.
        self.register_limiter.fail("ip:" + ip)
        print("  auth: registered '%s'%s%s" % (rec["username"], " [admin]" if is_admin else "",
                                               " [awaiting approval]" if disabled else ""))
        if disabled:
            return self._json(202, {"ok": True, "pendingApproval": True,
                                    "message": "Your account was created and is waiting for an administrator to approve it."})
        return self._start_session(rec)

    def _auth_change_password(self):
        cfg = self.config["auth"]
        if not self.principal.authenticated:
            return self._json(401, {"error": "Sign in first."})
        body = self._read_json(MAX_AUTH_BODY)
        if body is None:
            return self._json(400, {"error": "invalid request"})
        current = str(body.get("currentPassword") or "")
        new = str(body.get("newPassword") or "")
        ip = self._client_ip()
        wait = self.login_limiter.retry_after("pw:" + ip)
        if wait:
            return self._json(429, {"error": "Too many attempts. Try again in %d seconds." % wait})
        rec, _reason = self.users.verify(self.principal.username, current)
        if not rec:
            self.login_limiter.fail("pw:" + ip)
            return self._json(403, {"error": "Your current password is not correct."})
        ok, msg = webdoc_auth.validate_password(new, cfg.password_min_length)
        if not ok:
            return self._json(400, {"error": msg})
        self.users.set_password(self.principal.username, new)
        # Changing a password invalidates every session, including this one, then
        # issues a fresh one so the tab the user is in keeps working.
        self.sessions.destroy_user(self.principal.username)
        return self._start_session(self.users.get(self.principal.username))

    # -- administration ------------------------------------------------------
    def _auth_admin_users(self, parts):
        cfg = self.config["auth"]
        if not self.principal.admin:
            return self._json(403, {"error": "administrators only"})
        action = parts[0] if parts else ""
        body = self._read_json(MAX_AUTH_BODY)
        if body is None:
            return self._json(400, {"error": "invalid request"})
        target = str(body.get("username") or "").strip()
        if not target:
            return self._json(400, {"error": "username required"})
        rec = self.users.get(target)
        if action == "create":
            password = str(body.get("password") or "")
            ok, msg = webdoc_auth.validate_password(password, cfg.password_min_length)
            if not ok:
                return self._json(400, {"error": msg})
            created, err = self.users.create(
                target, password, body.get("displayName"),
                groups=self._clean_groups(body.get("groups")), admin=bool(body.get("admin")),
                disabled=bool(body.get("disabled")))
            if err:
                return self._json(409, {"error": err})
            return self._json(201, {"ok": True, "user": webdoc_auth.public_user(created)})
        if not rec:
            return self._json(404, {"error": "No such account."})
        if action == "update":
            self._guard_last_admin(rec, body)
            if "groups" in body:
                self.users.set_groups(target, self._clean_groups(body.get("groups")))
            if "admin" in body:
                self.users.set_admin(target, bool(body.get("admin")))
            if "disabled" in body:
                self.users.set_disabled(target, bool(body.get("disabled")))
            if "displayName" in body:
                self.users.set_display_name(target, body.get("displayName"))
            # A permission change must bite immediately, not at the next sign-in.
            self.sessions.destroy_user(target)
            return self._json(200, {"ok": True, "user": webdoc_auth.public_user(self.users.get(target))})
        if action == "reset-password":
            password = str(body.get("password") or "")
            ok, msg = webdoc_auth.validate_password(password, cfg.password_min_length)
            if not ok:
                return self._json(400, {"error": msg})
            self.users.set_password(target, password)
            self.sessions.destroy_user(target)
            return self._json(200, {"ok": True})
        if action == "delete":
            if webdoc_auth.normalize_username(target) == webdoc_auth.normalize_username(self.principal.username):
                return self._json(400, {"error": "You cannot delete the account you are signed in as."})
            if rec.get("admin") and self.users.admin_count(cfg.admin_groups) <= 1:
                return self._json(400, {"error": "That is the last administrator."})
            self.users.delete(target)
            self.sessions.destroy_user(target)
            return self._json(200, {"ok": True})
        return self._json(404, {"error": "unknown action"})

    def _guard_last_admin(self, rec, body):
        """Refuse an edit that would leave the server with no usable administrator -
        a lockout nobody can undo without hand-editing the account file."""
        cfg = self.config["auth"]
        was_admin = bool(rec.get("admin")) or cfg.is_admin_groups(rec.get("groups") or ())
        # Losing the flag, being disabled, OR being removed from every admin group
        # all end administrator rights, so all three count as "removing".
        losing_groups = ("groups" in body and was_admin
                         and not cfg.is_admin_groups(self._clean_groups(body.get("groups")))
                         and not (body.get("admin", rec.get("admin"))))
        removing = (("admin" in body and not body.get("admin")) or
                    ("disabled" in body and body.get("disabled")) or losing_groups)
        if was_admin and removing and self.users.admin_count(cfg.admin_groups) <= 1:
            raise _Refused("That is the last administrator; promote another account first.")

    def _clean_groups(self, raw):
        """Only groups declared in config.json may be assigned - otherwise an admin
        typo silently creates a group nothing grants and the user loses access."""
        cfg = self.config["auth"]
        if not isinstance(raw, list):
            return []
        known = set(cfg.known_groups())
        return [g for g in webdoc_auth.normalize_groups(raw) if g in known]

    def _file(self, fspath):
        try:
            with open(fspath, "rb") as fh:
                data = fh.read()
        except OSError:
            return self._json(404, {"error": "not found"})
        self._send_static(200, data, content_type(fspath))

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
        filtering = not self.gate.unrestricted
        entries = []
        for n in names:
            if n.startswith("."):
                continue
            fp = os.path.join(fsdir, n)
            is_dir = os.path.isdir(fp)
            rel_child = (rel + "/" + n).strip("/")
            if filtering and not self._listing_visible(name, rel_child, is_dir):
                continue
            url = "/docs/" + name + "/" + urllib.parse.quote(rel_child)
            if is_dir:
                url += "/"
            entries.append({"name": n, "type": "dir" if is_dir else "file", "url": url})
        if filtering and names and not entries:
            return self._not_found()
        self._json(200, {"type": "dir", "source": name, "path": rel, "entries": entries})

    def _listing_visible(self, source, rel_child, is_dir):
        """Whether one directory-listing entry may be named to this caller.

        The listing is a second way to discover what exists, so it applies the same
        rule as the tree: a hidden document is omitted, and a folder that contains
        nothing but hidden documents is omitted with it.
        """
        base = source + "/" + rel_child
        if is_dir:
            if not self.index:
                return True
            # Exactly the rule the drawer's tree uses, so the two never disagree:
            # a folder is worth naming only if something inside it is visible.
            level = self.index.tree(base, self.gate)
            return bool(level["docs"] or level["folders"])
        if rel_child.lower().endswith(".md"):
            return not self.gate.is_hidden(base[:-3])
        return self._asset_readable(source, rel_child)

    def _asset_readable(self, source, rel_child):
        """Whether a non-Markdown file (an image, an XML report) may be served.

        A file carries no metadata of its own, so it borrows its answer from the
        documents around it, in two steps:

        1. If any page in the library LINKS to it, it is exactly as visible as
           those pages: readable if the caller can read at least one of them. That
           is the honest rule - a diagram embedded in a public page is public, and
           the same diagram embedded only in a locked page is locked.
        2. If nothing links to it, fall back to the folder: every document in the
           nearest folder above it that has any must be readable. Nothing in the
           app can surface an unreferenced file, so being strict there costs
           nobody anything.

        Step 1 exists because the folder rule alone was unusable: one locked page
        at a source root made every logo and diagram at that level disappear.
        """
        if self.gate.unrestricted:
            return True
        if not self.index:
            return self._readable_site()
        asset_path = source + "/" + rel_child
        referrers = self.index.asset_referrers(asset_path)
        if referrers:
            return any(self.gate.can_read(d) for d in referrers)
        folder = asset_path.rsplit("/", 1)[0]
        # Memoised per request: a directory listing asks this once per file, and
        # every file in the same folder resolves to the same query.
        if folder in self._asset_cache:
            return self._asset_cache[folder]
        # Walk UP to the nearest folder that actually holds documents. A folder of
        # nothing but images has no ACL of its own; without this it fell through to
        # "any signed-in account", so dropping a diagram beside a locked chapter -
        # in its own subfolder - published it.
        probe = folder
        siblings = []
        while True:
            siblings = self.index.docs_in_folder(probe)
            if siblings or "/" not in probe:
                break
            probe = probe.rsplit("/", 1)[0]
        ok = self._readable_site() if not siblings else all(self.gate.can_read(d) for d in siblings)
        self._asset_cache[folder] = ok
        return ok

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
            # The auth block is published unauthenticated on purpose: the browser
            # has to know whether to render a sign-in wall before it can sign in.
            # It carries policy only - never an account, never a token.
            "auth": cfg["auth"].to_json(),
            "sources": [
                {"name": s["name"], "url": "/docs/" + s["name"] + "/",
                 "component": s["component"], "testResults": self._res_url(s)}
                for s in cfg["sources"]
            ],
        })

    # -- routing ------------------------------------------------------------
    def do_GET(self):
        self._dispatch(self.route)

    def do_HEAD(self):
        self._dispatch(self.route)

    def do_POST(self):
        self._dispatch(self._post)

    def _dispatch(self, fn):
        """Every verb enters here: resolve the caller once, run the route, and turn
        a policy refusal into a clean 400 instead of a stack trace."""
        try:
            self._begin()
        except Exception as e:
            return self._json(500, {"error": "auth unavailable: %s" % e})
        try:
            fn()
        except _Refused as e:
            self._json(400, {"error": str(e)})

    def _post(self):
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if not path.startswith("/api/auth/"):
            return self._json(405, {"error": "unsupported"})
        # Sign-in and registration change server state, so they are CSRF-guarded
        # like any other write; /api/auth/me hands the browser the token first.
        if not self._guard_mutation():
            return
        return self._auth_route_post(path[len("/api/auth/"):])

    def route(self):
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if path == "/site.json":
            return self._site_json()
        if path.startswith("/api/auth/"):
            return self._auth_route_get(path[len("/api/auth/"):])
        if path.startswith("/api/index/"):
            return self._index_route(path[len("/api/index/"):])
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
        # The app shell itself is always served: the sign-in screen is part of it,
        # so gating it would leave a signed-out visitor with a blank page.
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
        if self._acl_blocked():
            return self._not_ready()
        if os.path.isdir(fspath):
            if not self._readable_site():
                return self._deny(what="library")
            return self._listing(name, rel, fspath)
        if rel.lower().endswith(".md"):
            return self._doc_file(src, fspath)
        # The per-source results sidecars are served through this same mount.
        # They are index data, not documents, and have their own filtered API -
        # serving the raw file would hand over results for pages the caller
        # cannot read.
        if os.path.basename(fspath) in (self.TESTS_FILE, self.AUTO_FILE):
            if not self._can_write_source(name):
                return self._not_found()
        if not self._asset_readable(name, rel):
            # 403 confirms the file exists; 404 does not. Only say "forbidden"
            # when the folder itself is visible - otherwise probing filenames one
            # at a time would map out a folder that is meant to be invisible.
            folder = (name + "/" + rel).rsplit("/", 1)[0]
            level = self.index.tree(folder, self.gate) if self.index else None
            visible = bool(level and (level["docs"] or level["folders"]))
            if visible and self._readable_site():
                return self._deny(what="file")
            return self._not_found()
        return self._file(fspath)

    def _doc_file(self, src, fspath):
        """Serve one document, section-redacted for this reader.

        The browser gets the file verbatim, so this is the ONLY place a restricted
        section can be withheld - filtering it client-side would be decoration.
        """
        doc_id = self._doc_id_for(src, fspath)
        vis = self.gate.visibility(doc_id)
        if vis == webdoc_access.HIDDEN:
            return self._not_found()
        if vis == webdoc_access.LOCKED:
            return self._deny(self.gate.eff(doc_id))
        try:
            with open(fspath, "rb") as fh:
                data = fh.read()
        except OSError:
            return self._not_found()
        cfg = self.config["auth"]
        if cfg.enabled:
            text = data.decode("utf-8-sig", "replace")
            # Neutralise any ```wd-restricted fence the AUTHOR wrote before adding
            # the server's own. Otherwise a document could forge the redaction
            # notice, and - the part that actually matters - wrap real content in a
            # fake one so a cleared reader never sees it.
            text = webdoc_access.neutralise_forged_notices(text)
            redacted, n = webdoc_access.redact_sections(cfg, self.principal, text)
            data = redacted.encode("utf-8")
        # Same read-a-file-and-send path as _file, so it gets the same encoding
        # treatment - documents are Markdown, and Markdown compresses well.
        self._send_static(200, data, content_type(fspath))

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
        if not self._readable_site():
            return self._deny(what="results")
        try:
            with open(fp, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            data = {}
        return self._json(200, self._filter_results(data))

    def _filter_results(self, data):
        """Drop stored results whose requirement or test lives in a document this
        reader cannot open - a pass/fail keyed by `T_WD_deploy` would otherwise
        confirm that a restricted test exists, and name it."""
        if self.gate.unrestricted or not isinstance(data, dict) or not self.index:
            return data
        owner = self.index.result_key_owner()
        out = {}
        for key, value in data.items():
            doc_id = owner.get(key)
            if doc_id is None:
                # No owner in the index: either stale, or - the case that matters -
                # a test declared inside a restricted section, which is deliberately
                # not indexed. Withhold it rather than guess.
                continue
            if not self.gate.can_read(doc_id):
                continue
            out[key] = value
        return out

    def _sidecar_put(self, name, filename):
        fp = self._sidecar_path(name, filename)
        if fp is None:
            return self._json(404, {"error": "unknown source"})
        if not self._can_write_source(name):
            return self._deny(what="results")
        body = self._read_body(MAX_JSON_BODY)
        if body is None:
            return self._json(413, {"error": "request body rejected"})
        try:
            obj = json.loads((body or b"{}").decode("utf-8"))  # validate it's JSON
        except (ValueError, UnicodeDecodeError) as e:
            return self._json(400, {"error": str(e)})
        if not isinstance(obj, dict):
            return self._json(400, {"error": "expected a JSON object"})
        # A restricted reader never received the withheld keys, so writing back
        # what they DO have would silently delete results they cannot see. Merge
        # onto the stored file instead of replacing it.
        if not self.gate.unrestricted:
            try:
                with open(fp, encoding="utf-8") as fh:
                    stored = json.load(fh)
            except (OSError, ValueError):
                stored = {}
            if isinstance(stored, dict):
                owner = self.index.result_key_owner() if self.index else {}
                hidden_keys = {k: v for k, v in stored.items()
                               if owner.get(k) and not self.gate.can_read(owner[k])}
                hidden_keys.update(obj)
                obj = hidden_keys
        try:
            tmp = "%s.%d.tmp" % (fp, threading.get_ident())   # unique per writer
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(obj, fh, indent=2)
            os.replace(tmp, fp)
        except OSError as e:
            return self._json(500, {"error": str(e)})
        return self._json(200, {"ok": True})

    def _can_write_source(self, name):
        """Whether this caller may write a source's shared sidecar. Modelled on an
        unrestricted document in that source: if they could not edit an ordinary
        page, they cannot record results either."""
        cfg = self.config["auth"]
        if not cfg.enabled:
            return True
        if not self._source(str(name).strip("/")):
            return False
        return webdoc_access.can_write(cfg, self.principal, webdoc_access.UNRESTRICTED)

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
        if not self._readable_site():
            return self._deny(what="reports")
        out = []
        for root, _dirs, files in os.walk(src["path"]):
            for f in files:
                if f.lower().endswith(".xml"):
                    rel = os.path.relpath(os.path.join(root, f), src["path"]).replace("\\", "/")
                    if not self._asset_readable(src["name"], rel):
                        continue
                    out.append("/docs/" + src["name"] + "/" + urllib.parse.quote(rel))
        out.sort()
        return self._json(200, out)

    def _check_write(self, doc_id, fspath, body):
        """Authorise one document write. -> None to proceed, or a truthy sent
        response (see _send/_json) that the caller must return on immediately.

        Two separate gates, deliberately:
          1. WRITE rights on the document (inherited down `next` like read rights).
          2. ACL-EDIT rights, but only if this write CHANGES an access block.
        Without (2) the whole model would be advisory: anyone able to edit a locked
        page could simply delete its `access` block and publish it.
        """
        cfg = self.config["auth"]
        if not cfg.enabled:
            return None
        if webdoc_index is None:
            return self._json(503, {"error": "document parsing is unavailable; writes are refused"})
        vis = self.gate.visibility(doc_id)
        if vis == webdoc_access.HIDDEN:
            return self._not_found()
        if not self.gate.can_write(doc_id):
            return self._deny(self.gate.eff(doc_id))
        try:
            text = body.decode("utf-8-sig")
        except UnicodeDecodeError:
            return self._json(400, {"error": "documents must be valid UTF-8"})
        new_meta, new_body = webdoc_index.split_meta(text)
        new_sig = webdoc_access.access_signature(new_meta, new_body)
        try:
            with open(fspath, encoding="utf-8-sig") as fh:
                old_text = fh.read()
        except OSError:
            old_text = None
        if old_text is not None:
            # This reader was served a REDACTED copy of the file. Saving it back
            # would overwrite the withheld sections with their placeholders, so a
            # partial view is a read-only view - never a lossy write.
            _r, withheld = webdoc_access.redact_sections(cfg, self.principal, old_text)
            if withheld:
                return self._json(403, {
                    "error": "This page contains %d section(s) you are not cleared to see, "
                             "so it cannot be edited here." % withheld,
                    "redactedSections": withheld,
                })
            old_meta, old_body = webdoc_index.split_meta(old_text)
            old_sig = webdoc_access.access_signature(old_meta, old_body)
        else:
            old_sig = webdoc_access.access_signature({}, "")   # creating a new file
        # A restricted page's `next`/`assumes` lists ARE part of its access rule:
        # everything downstream inherits through them, so quietly dropping an edge
        # unlocks a whole chapter without touching a single access block.
        eff = self.gate.eff(doc_id)
        if (eff.get("read") is not None or eff.get("hidden")) and old_text is not None:
            def rel(meta):
                return json.dumps({k: sorted(str(v) for v in (meta.get(k) or []))
                                   for k in ("next", "assumes")}, sort_keys=True)
            if rel(new_meta) != rel(old_meta) and not webdoc_access.can_edit_acl(cfg, self.principal):
                self._json(403, {
                    "error": "This page is restricted, so changing its Assumed-knowledge or "
                             "Recommended-next links needs access-management rights - those links "
                             "are what carry the restriction to the pages after it.",
                    "aclChange": True,
                    "requiresGroups": sorted(cfg.acl_editor_groups()),
                })
                return True
        if new_sig != old_sig and not webdoc_access.can_edit_acl(cfg, self.principal):
            return self._json(403, {
                "error": "Changing who can see this page needs access-management rights.",
                "aclChange": True,
                "requiresGroups": sorted(cfg.acl_editor_groups()),
            })
        return None

    def do_PUT(self):
        self._dispatch(self._put)

    def _put(self):
        """Write a document (PUT /docs/<source>/<path>.md, raw Markdown body) or a
        source's results sidecar (PUT /api/tests/<source>, JSON body)."""
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if not self._guard_mutation():
            return
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
        if self._acl_blocked():
            return self._not_ready()
        doc_id = self._doc_id_for(src, fspath)
        body = self._read_body(MAX_DOC_BODY)
        if body is None:
            return self._json(413, {"error": "request body rejected"})
        # Check and write under one lock. The gap between "may they write this?"
        # and the write is small but real: two interleaved PUTs could otherwise
        # land a body that no check ever approved.
        with self.write_lock:
            if self._check_write(doc_id, fspath, body):
                return
            try:
                existed = os.path.exists(fspath)
                os.makedirs(os.path.dirname(fspath), exist_ok=True)
                with open(fspath, "wb") as fh:
                    fh.write(body)
            except (OSError, ValueError) as e:
                return self._json(500, {"error": str(e)})
            if self.index:   # keep the index in step with the write (incremental, cheap)
                try:
                    # Index under the CANONICAL relative path, not the URL's
                    # spelling - a case-variant URL would otherwise create a second
                    # index row that no ACL is attached to.
                    self.index.update_doc(name, os.path.relpath(fspath, src["path"]).replace("\\", "/"),
                                          body.decode("utf-8", "replace"))
                except Exception as e:
                    print("  ! index update failed:", e)
        doc_id = name + "/" + rel[:-3]  # drop the .md
        return self._json(200 if existed else 201,
                          {"ok": True, "id": doc_id, "created": not existed})

    def _check_delete(self, doc_id, fspath):
        """Authorise a delete. Write rights are necessary but not sufficient: a
        document holding sections you cannot read cannot be destroyed by you
        either, and removing a locked page is itself an access change."""
        cfg = self.config["auth"]
        if not cfg.enabled:
            return None
        vis = self.gate.visibility(doc_id)
        if vis == webdoc_access.HIDDEN:
            return self._not_found()
        if not self.gate.can_write(doc_id):
            return self._deny(self.gate.eff(doc_id))
        try:
            with open(fspath, encoding="utf-8-sig") as fh:
                text = fh.read()
        except OSError:
            return self._not_found()
        _r, withheld = webdoc_access.redact_sections(cfg, self.principal, text)
        if withheld:
            return self._json(403, {"error": "This page contains sections you are not cleared to see, "
                                             "so it cannot be deleted here.", "redactedSections": withheld})
        eff = self.gate.eff(doc_id)
        if (eff.get("read") is not None or eff.get("hidden")) and not webdoc_access.can_edit_acl(cfg, self.principal):
            return self._json(403, {"error": "Deleting a restricted page needs access-management rights.",
                                    "aclChange": True,
                                    "requiresGroups": sorted(cfg.acl_editor_groups())})
        return None

    def do_DELETE(self):
        self._dispatch(self._delete)

    def _delete(self):
        """Delete a document: DELETE /docs/<source>/<path>.md. Removes the .md
        file and prunes any parent folders it leaves empty (never the source
        root). This is how the in-app CRUD "delete document" action removes a doc."""
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if not self._guard_mutation():
            return
        if not path.startswith("/docs/"):
            return self._json(405, {"error": "deletes are only allowed under /docs/"})
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
        if not os.path.isfile(fspath):
            return self._json(404, {"error": "not found"})
        if self._acl_blocked():
            return self._not_ready()
        canon_rel = os.path.relpath(fspath, src["path"]).replace("\\", "/")
        doc_id = self._doc_id_for(src, fspath)
        # Same lock as the write path: check and act atomically.
        with self.write_lock:
            if self._check_delete(doc_id, fspath):
                return
            try:
                os.remove(fspath)
                # Prune now-empty parent directories up to (but never including) the
                # source root, so deleting the last doc in a folder doesn't leave an
                # empty branch in the tree.
                root_abs = os.path.abspath(src["path"])
                d = os.path.dirname(os.path.abspath(fspath))
                while d != root_abs and d.startswith(root_abs + os.sep):
                    if os.listdir(d):
                        break
                    os.rmdir(d)
                    d = os.path.dirname(d)
            except OSError as e:
                return self._json(500, {"error": str(e)})
            if self.index:
                try:
                    self.index.delete_doc(name, canon_rel)
                except Exception as e:
                    print("  ! index delete failed:", e)
        return self._json(200, {"ok": True, "id": doc_id, "deleted": True})

    def log_message(self, fmt, *args):
        print("  %s - %s" % (self.address_string(), fmt % args))


def watch_loop(idx, interval):
    """Background thread: periodically re-scan the source folders so .md files
    added/edited/removed OUTSIDE the app (not via PUT/DELETE) get picked up
    without a restart. idx.reconcile() is the same incremental, mtime/size-gated
    scan used for the cold build, so an idle poll is cheap - it does real work
    only when a file has actually changed."""
    while True:
        time.sleep(interval)
        try:
            idx.reconcile()
        except Exception as e:
            print("  ! index watch reconcile failed:", e)


def session_sweeper(sessions, interval=300):
    while True:
        time.sleep(interval)
        try:
            sessions.sweep()
        except Exception as e:
            print("  ! session sweep failed:", e)


def setup_auth(cfg, host):
    """Attach the account store, session store and rate limiters to the handler,
    and print exactly what the security posture is - an operator should never have
    to read the code to find out whether their server is open."""
    auth = cfg["auth"]
    DocHandler.csp = build_csp(auth)
    if not auth.enabled:
        print("  auth: DISABLED - anyone who can reach this server can read AND edit every document")
        if host not in ("127.0.0.1", "localhost", "::1"):
            print("        (bound to %s, so that means anyone on the network)" % host)
        return
    DocHandler.users = webdoc_auth.UserStore(auth.users_file, auth.pbkdf2_iterations)
    DocHandler.sessions = webdoc_auth.SessionStore(
        idle_seconds=auth.session_idle_minutes * 60, absolute_seconds=auth.session_max_hours * 3600)
    DocHandler.login_limiter = webdoc_auth.RateLimiter(auth.max_login_failures, 300, auth.lockout_seconds)
    DocHandler.ip_limiter = webdoc_auth.RateLimiter(auth.max_login_failures * 6, 300, auth.lockout_seconds)
    DocHandler.register_limiter = webdoc_auth.RateLimiter(max(3, auth.max_login_failures // 2), 3600, 900)
    threading.Thread(target=session_sweeper, args=(DocHandler.sessions,), daemon=True).start()
    n = DocHandler.users.count()
    print("  auth: ENABLED - %d account(s), %s" % (
        n, "registration open" if auth.allow_registration else "registration closed"))
    print("        accounts: %s" % auth.users_file)
    print("        groups:   %s" % (", ".join(auth.known_groups()) or "(none declared)"))
    if auth.public_read:
        print("        publicRead is ON: unrestricted documents are readable without signing in")
    if n == 0 and auth.allow_registration:
        print("        no accounts yet - the FIRST account registered becomes the administrator")
    if n == 0 and not auth.allow_registration:
        print("        ! no accounts exist and registration is closed - nobody can sign in")
    if host not in ("127.0.0.1", "localhost", "::1") and not auth.cookie_secure:
        print("        ! bound to %s over plain HTTP: passwords and session cookies travel in the clear."
              % host)
        print("          Put this behind HTTPS and set auth.cookieSecure true.")


def build_csp(auth):
    """The Content-Security-Policy sent with every response.

    Everything this app needs is same-origin, so the policy is simply 'self' plus
    a hash for the theme-resolving inline script - no 'unsafe-inline', so a
    sanitizer escape does not become script execution.
    """
    if not auth.security_headers:
        return None
    if isinstance(auth.content_security_policy, str) and auth.content_security_policy.strip():
        return auth.content_security_policy.strip()      # operator override
    script_src = ["'self'"] + _inline_script_hashes(os.path.join(APP_DIR, "index.html"))
    return "; ".join([
        "default-src 'self'",
        "script-src " + " ".join(script_src),
        "style-src 'self' 'unsafe-inline'",              # the app sets inline styles on nodes
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",                            # the app never submits a form
        "frame-ancestors 'none'",
    ])


def main():
    ap = argparse.ArgumentParser(description="Web Document Tool static server")
    ap.add_argument("--config", default=os.path.join(HERE, "config.json"))
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    cfg = load_config(args.config)
    DocHandler.config = cfg
    setup_auth(cfg, args.host)

    # Build the SQLite index in the BACKGROUND so serving starts immediately; the
    # client polls /api/index/status. Optional + fault-tolerant: if it can't start,
    # the server still serves files (the client can fall back to client-side discovery).
    try:
        from webdoc_index import Index
        idx = Index(HERE, cfg["sources"], index_body=cfg.get("indexBody", False),
                    index_dir=cfg.get("indexDir"), propagate_via=cfg.get("propagateVia", ("next",)))
        DocHandler.index = idx
        threading.Thread(target=idx.reconcile, daemon=True).start()
        print("  index: sqlite (.webdoc-index/), building in background"
              + ("  [+full-text body]" if cfg.get("indexBody") else ""))
        watch_interval = cfg.get("watchIntervalSec", 3)
        if watch_interval:
            threading.Thread(target=watch_loop, args=(idx, watch_interval), daemon=True).start()
            print(f"  watch: rescanning source folders every {watch_interval}s for external changes")
    except Exception as e:
        DocHandler.index = None
        print(f"  ! index disabled ({e})")

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
