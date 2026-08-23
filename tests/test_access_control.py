"""Accounts, sessions and document access control - end to end against a real
serve.py process.

No browser and no Playwright: these drive the HTTP surface directly, because the
security properties being checked are properties of the SERVER. Anything the
browser does is decoration on top; a test that clicked through the UI could pass
while the API happily handed a restricted document to a `curl`.

Each test class gets its own server on its own port with its own temporary
library and account file, so nothing leaks between them.
"""
import http.client
import http.cookiejar
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSRF_HEADER = "X-WebDoc-CSRF"


# --------------------------------------------------------------------------- #
# a tiny HTTP client with a cookie jar
# --------------------------------------------------------------------------- #
class Client:
    """One browser-ish session: keeps cookies, echoes the CSRF token."""

    def __init__(self, base):
        self.base = base.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = None

    def _cookie(self, name):
        for c in self.jar:
            if c.name == name:
                return c.value
        return None

    def request(self, method, path, body=None, json_body=None, headers=None, csrf=True):
        url = self.base + path
        data = body
        hdrs = dict(headers or {})
        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        if csrf and method not in ("GET", "HEAD"):
            token = self.csrf or self._cookie("wd_csrf")
            if token:
                hdrs[CSRF_HEADER] = token
        # One retry, and ONLY for a transport-level failure. These tests assert
        # policy outcomes; a dropped TCP connection is a property of the machine
        # (a busy Windows box drops the occasional accept), not of the access
        # model, and letting it fail the run just teaches people to ignore reds.
        # An HTTP status - including 403 and 429 - is always an answer, never
        # retried.
        for attempt in (0, 1):
            req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
            try:
                # Generous timeout: a PBKDF2 login on a loaded machine is not
                # fast, and a spurious timeout in a security suite is worse than
                # a slow one.
                with self.opener.open(req, timeout=60) as resp:
                    return Response(resp.status, resp.read(), dict(resp.headers))
            except urllib.error.HTTPError as e:
                return Response(e.code, e.read(), dict(e.headers))
            except (urllib.error.URLError, http.client.HTTPException, OSError):
                if attempt:
                    raise
                time.sleep(0.4)

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, payload=None, **kw):
        return self.request("POST", path, json_body=payload if payload is not None else {}, **kw)

    def put(self, path, body, **kw):
        return self.request("PUT", path, body=body.encode("utf-8") if isinstance(body, str) else body, **kw)

    def delete(self, path, **kw):
        return self.request("DELETE", path, **kw)

    # -- convenience --
    def bootstrap_csrf(self):
        r = self.get("/api/auth/me")
        self.csrf = r.json().get("csrf")
        return r

    def login(self, username, password):
        self.bootstrap_csrf()
        r = self.post("/api/auth/login", {"username": username, "password": password})
        if r.status == 200:
            self.csrf = r.json().get("csrf")
        return r

    def register(self, username, password, display=None):
        self.bootstrap_csrf()
        r = self.post("/api/auth/register",
                      {"username": username, "password": password, "displayName": display or username})
        if r.status == 200:
            self.csrf = r.json().get("csrf")
        return r


class Response:
    def __init__(self, status, body, headers):
        self.status = status
        self.body = body
        self.headers = headers

    def json(self):
        try:
            return json.loads(self.body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    def text(self):
        return self.body.decode("utf-8", "replace")


# --------------------------------------------------------------------------- #
# server fixture
# --------------------------------------------------------------------------- #
def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _write_library(folder):
    """A small library shaped to exercise every rule:

        public          - no ACL at all
        chapter/intro   - read: staff              (explicit)
          -> chapter/middle                        (inherits staff via `next`)
            -> chapter/deep                        (inherits staff, two hops)
        secret          - read: nobody + hidden    (must not exist, to anyone)
        mixed           - public page with a staff-only SECTION
        merged          - reachable from intro AND from ops-entry (union)
        ops-entry       - read: ops
    """
    def w(rel, text):
        path = os.path.join(folder, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)

    w("public.md", '<!--meta\n{ "title": "Public", "description": "open to all" }\n-->\n\n'
                   '# Public\n\nEveryone may read this. keyword_public\n\n'
                   '![logo](open-logo.svg)\n')
    w("chapter/intro.md", '<!--meta\n{ "title": "Intro", "next": ["Lib/chapter/middle", "Lib/merged"],'
                          ' "access": { "read": ["staff"] } }\n-->\n\n# Intro\n\nkeyword_intro\n\n'
                          '![diagram](assets/secret-diagram.svg)\n')
    # Three files that are not documents, in the three positions that matter:
    # referenced from a public page, referenced only from a locked page, and
    # referenced by nothing at all.
    w("open-logo.svg", '<svg><text>PUBLIC_IMAGE_BYTES</text></svg>')
    w("chapter/assets/secret-diagram.svg", '<svg><text>LOCKED_IMAGE_BYTES</text></svg>')
    w("chapter/assets/diagram.svg", '<svg><text>keyword_chapter_asset</text></svg>')
    w("chapter/middle.md", '<!--meta\n{ "title": "Middle", "next": ["Lib/chapter/deep"] }\n-->\n\n'
                           '# Middle\n\nkeyword_middle\n')
    w("chapter/deep.md", '<!--meta\n{ "title": "Deep" }\n-->\n\n# Deep\n\nkeyword_deep\n')
    w("ops-entry.md", '<!--meta\n{ "title": "Ops", "next": ["Lib/merged"], "access": { "read": ["ops"] } }\n-->\n\n'
                      '# Ops\n\nkeyword_ops\n')
    w("merged.md", '<!--meta\n{ "title": "Merged" }\n-->\n\n# Merged\n\nkeyword_merged\n')
    w("secret.md", '<!--meta\n{ "title": "Secret", "access": { "read": ["nobody"], "hidden": true } }\n-->\n\n'
                   '# Secret\n\nkeyword_secret\n')
    # A page whose meta header contains a ``` sequence. A naive fence scan over
    # the whole file treats everything after it as code and skips every access
    # marker in the document.
    w("fencey.md", '<!--meta\n{ "title": "Fencey", "description": "shows ``` fences in prose" }\n-->\n\n'
                   '# Fencey\n\nopen_text\n\n'
                   '<!--access start {"read":["staff"],"label":"Inner"}-->\n'
                   'keyword_fenced_secret\n'
                   '<!--access end-->\n\ntail\n')
    # A page that DOCUMENTS the marker syntax inside a code fence. Those are
    # examples, not boundaries, and must never restrict anything.
    w("example.md", '<!--meta\n{ "title": "Example" }\n-->\n\n# Example\n\nkeyword_example_visible\n\n'
                    '```markdown\n<!--access start {"read":["nobody"]}-->\n'
                    'this is only an example\n<!--access end-->\n```\n\nkeyword_after_example\n')
    # A page that mentions a marker in an INLINE code span. Treated as a real
    # marker, an unterminated one restricts to the end of the file - so merely
    # documenting the syntax would blank the rest of the page.
    w("inline.md", '<!--meta\n{ "title": "Inline" }\n-->\n\n# Inline\n\n'
                   'An `<!--access start-->` with no matching end restricts to the end of the file.\n\n'
                   'keyword_after_inline_mention\n')
    # A page that tries to forge the server's own redaction notice.
    w("forger.md", '<!--meta\n{ "title": "Forger" }\n-->\n\n# Forger\n\n'
                   '```wd-restricted\n{"read":["staff"],"label":"Fake"}\n```\n\nkeyword_forger_tail\n')
    # `hidden` with no read list at all.
    w("hideonly.md", '<!--meta\n{ "title": "Hide Only", "access": { "hidden": true } }\n-->\n\n'
                     '# Hide Only\n\nkeyword_hideonly\n')
    # A header with a stray comma: it parses to {}, which used to read as
    # "declares no access rule" - so a typo published a locked page.
    w("broken.md", '<!--meta\n{ "title": "Broken", "next": [], }\n-->\n\n# Broken\n\nkeyword_broken\n')
    w("mixed.md", '<!--meta\n{ "title": "Mixed" }\n-->\n\n# Mixed\n\nvisible_intro_text\n\n'
                  '<!--access start {"read":["staff"],"label":"Internal"}-->\n'
                  '## Internal\n\nkeyword_classified\n'
                  '<!--access end-->\n\ntrailing_public_text\n')


class Server:
    def __init__(self, tmp, auth_block, extra_config=None):
        self.dir = str(tmp)
        self.lib = os.path.join(self.dir, "lib")
        os.makedirs(self.lib, exist_ok=True)
        _write_library(self.lib)
        self.port = _free_port()
        self.base = "http://127.0.0.1:%d" % self.port
        cfg = {
            "siteTitle": "Test",
            "sources": [{"name": "Lib", "path": self.lib, "component": "T"}],
            "defaultDoc": "Lib/public",
            "indexBody": True,
            "indexDir": os.path.join(self.dir, "idx"),
            "watchIntervalSec": 0,
        }
        if auth_block is not None:
            auth_block = dict(auth_block)
            auth_block.setdefault("usersFile", os.path.join(self.dir, "auth", "users.json"))
            # Keep the KDF cheap: these tests do dozens of logins and the cost
            # factor is not what they are measuring.
            auth_block.setdefault("pbkdf2Iterations", 50000)
            cfg["auth"] = auth_block
        cfg.update(extra_config or {})
        self.config_path = os.path.join(self.dir, "config.json")
        with open(self.config_path, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh)
        self.proc = None

    def start(self):
        # Log to a FILE, not a pipe. serve.py prints a line per request, and an
        # unread pipe fills at ~64 KB and blocks the server mid-response - which
        # surfaces as a random RemoteDisconnected somewhere deep in the suite.
        self.log_path = os.path.join(self.dir, "server.log")
        self.log = open(self.log_path, "w", encoding="utf-8")
        self.proc = subprocess.Popen(
            [sys.executable, os.path.join(ROOT, "serve.py"),
             "--config", self.config_path, "--host", "127.0.0.1", "--port", str(self.port)],
            cwd=ROOT, stdout=self.log, stderr=subprocess.STDOUT, text=True)
        deadline = time.time() + 30
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError("serve.py exited: " + self._log_tail())
            try:
                c = Client(self.base)
                r = c.get("/site.json")
                if r.status == 200:
                    # Wait for the first index build so ACLs are computed.
                    for _ in range(120):
                        s = c.get("/api/index/status").json()
                        if s.get("state") == "ready" and s.get("docs", 0) >= 12:
                            return self
                        time.sleep(0.1)
                    return self
            except Exception:
                pass
            time.sleep(0.15)
        raise RuntimeError("serve.py did not come up on %s" % self.base)

    def client(self):
        return Client(self.base)

    def _log_tail(self, lines=40):
        try:
            self.log.flush()
            with open(self.log_path, encoding="utf-8", errors="replace") as fh:
                return "".join(fh.readlines()[-lines:])
        except OSError:
            return "(no log)"

    def stop(self):
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        try:
            self.log.close()
        except Exception:
            pass


@pytest.fixture(scope="module")
def open_server(tmp_path_factory):
    """Auth absent from config.json entirely - the pre-accounts behaviour."""
    s = Server(tmp_path_factory.mktemp("open"), None).start()
    yield s
    s.stop()


@pytest.fixture(scope="module")
def secured(tmp_path_factory):
    s = Server(tmp_path_factory.mktemp("secure"), {
        "enabled": True,
        "allowRegistration": True,
        "groups": {"staff": {"label": "Staff", "color": "#3355ff"},
                   "ops": {"label": "Operations"},
                   "admins": {"label": "Administrators"}},
    }).start()
    yield s
    s.stop()


@pytest.fixture(scope="module")
def accounts(secured):
    """One admin (the bootstrap account), one staff member, one plain reader."""
    admin = secured.client()
    r = admin.register("rootadmin", "correct-horse-battery")
    assert r.status == 200, r.text()
    assert r.json()["user"]["admin"] is True

    made = {}
    for name, groups in (("staffer", ["staff"]), ("plain", []), ("opsuser", ["ops"])):
        r = admin.post("/api/auth/users/create",
                       {"username": name, "password": "correct-horse-battery", "groups": groups})
        assert r.status == 201, r.text()
        c = secured.client()
        assert c.login(name, "correct-horse-battery").status == 200
        made[name] = c
    made["rootadmin"] = admin
    made["anon"] = secured.client()
    made["anon"].bootstrap_csrf()
    return made


# --------------------------------------------------------------------------- #
# 1. auth disabled: nothing changes
# --------------------------------------------------------------------------- #
class TestAuthDisabled:
    def test_site_reports_auth_off(self, open_server):
        body = open_server.client().get("/site.json").json()
        assert body["auth"]["enabled"] is False

    def test_every_document_is_readable(self, open_server):
        c = open_server.client()
        for doc in ("public", "secret", "chapter/intro", "mixed"):
            r = c.get("/docs/Lib/%s.md" % doc)
            assert r.status == 200, doc

    def test_restricted_section_is_not_redacted(self, open_server):
        r = open_server.client().get("/docs/Lib/mixed.md")
        assert "keyword_classified" in r.text()

    def test_writes_need_no_csrf_token(self, open_server):
        c = open_server.client()
        r = c.put("/docs/Lib/scratch.md", '<!--meta\n{"title":"S"}\n-->\n\n# S\n', csrf=False)
        assert r.status in (200, 201), r.text()
        assert c.delete("/docs/Lib/scratch.md", csrf=False).status == 200

    def test_tree_lists_everything(self, open_server):
        docs = open_server.client().get("/api/index/tree?path=Lib").json()["docs"]
        assert any(d["id"] == "Lib/secret" for d in docs)


# --------------------------------------------------------------------------- #
# 2. registration + sign-in
# --------------------------------------------------------------------------- #
class TestAccounts:
    def test_first_account_becomes_administrator(self, accounts):
        assert accounts["rootadmin"].get("/api/auth/me").json()["user"]["admin"] is True

    def test_later_accounts_are_not_administrators(self, accounts):
        assert accounts["plain"].get("/api/auth/me").json()["user"]["admin"] is False

    def test_wrong_password_is_rejected(self, secured):
        c = secured.client()
        r = c.login("staffer", "nope-nope-nope")
        assert r.status == 401
        assert "Incorrect username or password" in r.json()["error"]

    def test_unknown_user_gives_the_same_message(self, secured):
        c = secured.client()
        r = c.login("no-such-person", "nope-nope-nope")
        assert r.status == 401
        assert "Incorrect username or password" in r.json()["error"]

    def test_password_hash_never_leaves_the_server(self, accounts):
        body = accounts["rootadmin"].get("/api/auth/users").text()
        assert "passwordHash" not in body
        assert "pbkdf2" not in body

    def test_session_cookie_is_httponly_and_samesite(self, secured):
        c = secured.client()
        c.bootstrap_csrf()
        r = c.post("/api/auth/login", {"username": "staffer", "password": "correct-horse-battery"})
        setc = r.headers.get("Set-Cookie", "")
        raw = "\n".join(v for k, v in r.headers.items() if k.lower() == "set-cookie") or setc
        assert "HttpOnly" in raw
        assert "SameSite=Strict" in raw

    def test_logout_ends_the_session(self, secured):
        c = secured.client()
        assert c.login("plain", "correct-horse-battery").status == 200
        assert c.post("/api/auth/logout").status == 200
        assert c.get("/api/auth/me").json()["user"] is None

    def test_short_passwords_are_refused(self, accounts):
        r = accounts["rootadmin"].post("/api/auth/users/create", {"username": "tiny", "password": "short"})
        assert r.status == 400

    def test_duplicate_username_is_refused(self, accounts):
        r = accounts["rootadmin"].post("/api/auth/users/create",
                                       {"username": "STAFFER", "password": "correct-horse-battery"})
        assert r.status == 409

    def test_repeated_failures_are_rate_limited(self, secured):
        c = secured.client()
        c.bootstrap_csrf()
        statuses = [c.post("/api/auth/login",
                           {"username": "ratelimit-probe", "password": "wrong-wrong-wrong"}).status
                    for _ in range(12)]
        assert 429 in statuses, statuses


# --------------------------------------------------------------------------- #
# 3. CSRF + cross-origin
# --------------------------------------------------------------------------- #
class TestCsrf:
    def test_write_without_a_token_is_refused(self, accounts):
        r = accounts["rootadmin"].put("/docs/Lib/public.md", "# nope\n", csrf=False)
        assert r.status == 403
        assert r.json().get("csrf") is True

    def test_write_with_a_wrong_token_is_refused(self, accounts):
        r = accounts["rootadmin"].put("/docs/Lib/public.md", "# nope\n",
                                      headers={CSRF_HEADER: "not-the-token"}, csrf=False)
        assert r.status == 403

    def test_login_from_another_origin_is_refused(self, secured):
        c = secured.client()
        c.bootstrap_csrf()
        r = c.post("/api/auth/login", {"username": "staffer", "password": "correct-horse-battery"},
                   headers={"Origin": "http://evil.example"})
        assert r.status == 403

    def test_delete_without_a_token_is_refused(self, accounts):
        assert accounts["rootadmin"].delete("/docs/Lib/public.md", csrf=False).status == 403


# --------------------------------------------------------------------------- #
# 4. read access + recursive propagation
# --------------------------------------------------------------------------- #
class TestReadAccess:
    def test_public_document_is_readable_by_any_account(self, accounts):
        assert accounts["plain"].get("/docs/Lib/public.md").status == 200

    def test_anonymous_visitor_is_locked_out(self, accounts):
        r = accounts["anon"].get("/docs/Lib/public.md")
        assert r.status == 403
        assert r.json()["signInRequired"] is True

    def test_explicitly_restricted_document(self, accounts):
        assert accounts["staffer"].get("/docs/Lib/chapter/intro.md").status == 200
        assert accounts["plain"].get("/docs/Lib/chapter/intro.md").status == 403

    def test_lock_propagates_one_hop_down_next(self, accounts):
        assert accounts["staffer"].get("/docs/Lib/chapter/middle.md").status == 200
        assert accounts["plain"].get("/docs/Lib/chapter/middle.md").status == 403

    def test_lock_propagates_recursively(self, accounts):
        assert accounts["staffer"].get("/docs/Lib/chapter/deep.md").status == 200
        assert accounts["plain"].get("/docs/Lib/chapter/deep.md").status == 403

    def test_two_paths_union_their_groups(self, accounts):
        """`merged` is reachable from a staff page and an ops page, so either
        group may read it - a reader allowed down a path can keep walking it."""
        assert accounts["staffer"].get("/docs/Lib/merged.md").status == 200
        assert accounts["opsuser"].get("/docs/Lib/merged.md").status == 200
        assert accounts["plain"].get("/docs/Lib/merged.md").status == 403

    def test_administrator_reads_everything(self, accounts):
        for doc in ("chapter/deep", "secret", "ops-entry"):
            assert accounts["rootadmin"].get("/docs/Lib/%s.md" % doc).status == 200, doc

    def test_denial_names_the_groups_that_would_open_it(self, accounts):
        body = accounts["plain"].get("/docs/Lib/chapter/intro.md").json()
        assert body["requiresGroups"] == ["staff"]


# --------------------------------------------------------------------------- #
# 5. locked vs hidden
# --------------------------------------------------------------------------- #
class TestLockedAndHidden:
    def test_locked_page_appears_on_the_map(self, accounts):
        nodes = accounts["plain"].get("/api/index/graph").json()["nodes"]
        by_id = {n[0]: n for n in nodes}
        assert "Lib/chapter/intro" in by_id
        assert by_id["Lib/chapter/intro"][3] & 1, "expected the locked flag"

    def test_locked_page_withholds_its_description(self, accounts):
        nodes = {n[0]: n for n in accounts["plain"].get("/api/index/graph").json()["nodes"]}
        assert nodes["Lib/chapter/intro"][2] == ""

    def test_locked_page_shows_which_groups_open_it(self, accounts):
        payload = accounts["plain"].get("/api/index/graph").json()
        nodes = {n[0]: n for n in payload["nodes"]}
        groups = [payload["groups"][i] for i in nodes["Lib/chapter/intro"][4]]
        assert groups == ["staff"]

    def test_locked_page_is_listed_in_the_tree(self, accounts):
        docs = accounts["plain"].get("/api/index/tree?path=Lib/chapter").json()["docs"]
        entry = next(d for d in docs if d["id"] == "Lib/chapter/intro")
        assert entry.get("locked") is True

    def test_hidden_page_is_absent_from_the_map(self, accounts):
        ids = [n[0] for n in accounts["plain"].get("/api/index/graph").json()["nodes"]]
        assert "Lib/secret" not in ids

    def test_hidden_page_is_absent_from_the_tree(self, accounts):
        docs = accounts["plain"].get("/api/index/tree?path=Lib").json()["docs"]
        assert not any(d["id"] == "Lib/secret" for d in docs)

    def test_hidden_page_is_absent_from_the_directory_listing(self, accounts):
        names = [e["name"] for e in accounts["plain"].get("/docs/Lib/").json()["entries"]]
        assert "secret.md" not in names
        assert "public.md" in names

    def test_hidden_page_answers_404_not_403(self, accounts):
        """A hidden page must be indistinguishable from one that never existed."""
        real = accounts["plain"].get("/docs/Lib/secret.md")
        fake = accounts["plain"].get("/docs/Lib/no-such-file.md")
        assert real.status == 404
        assert real.json() == fake.json()

    def test_hidden_page_is_absent_from_search(self, accounts):
        hits = accounts["plain"].get("/api/index/search?q=keyword_secret").json()["results"]
        assert hits == []

    def test_hidden_page_does_not_resolve_as_a_link(self, accounts):
        got = accounts["plain"].get("/api/index/resolve?base=Lib/public&p=Lib/secret").json()["resolved"]
        assert got["Lib/secret"] is None


# --------------------------------------------------------------------------- #
# 6. search leakage
# --------------------------------------------------------------------------- #
class TestSearch:
    def test_locked_page_yields_no_snippet(self, accounts):
        hits = accounts["plain"].get("/api/index/search?q=keyword_intro").json()["results"]
        assert hits and hits[0]["id"] == "Lib/chapter/intro"
        assert hits[0]["snippet"] == ""
        assert hits[0]["locked"] is True

    def test_restricted_section_text_is_not_searchable(self, accounts):
        """Section prose is kept out of the index entirely, for everybody - an FTS
        snippet would otherwise quote withheld text straight back."""
        for who in ("plain", "staffer", "rootadmin"):
            hits = accounts[who].get("/api/index/search?q=keyword_classified").json()["results"]
            assert hits == [], who

    def test_public_text_is_still_searchable(self, accounts):
        hits = accounts["plain"].get("/api/index/search?q=keyword_public").json()["results"]
        assert any(h["id"] == "Lib/public" for h in hits)


# --------------------------------------------------------------------------- #
# 7. section-level redaction
# --------------------------------------------------------------------------- #
class TestSections:
    def test_section_is_withheld_from_an_unauthorised_reader(self, accounts):
        text = accounts["plain"].get("/docs/Lib/mixed.md").text()
        assert "keyword_classified" not in text
        assert "wd-restricted" in text
        assert "visible_intro_text" in text
        assert "trailing_public_text" in text

    def test_section_is_delivered_to_an_authorised_reader(self, accounts):
        text = accounts["staffer"].get("/docs/Lib/mixed.md").text()
        assert "keyword_classified" in text

    def test_redaction_names_the_group_needed(self, accounts):
        text = accounts["plain"].get("/docs/Lib/mixed.md").text()
        assert '"staff"' in text

    def test_a_partial_reader_cannot_save_the_page(self, accounts):
        """Saving a redacted copy would overwrite the withheld section with its
        placeholder, so a partial view is read-only."""
        text = accounts["plain"].get("/docs/Lib/mixed.md").text()
        r = accounts["plain"].put("/docs/Lib/mixed.md", text)
        assert r.status == 403
        assert r.json()["redactedSections"] == 1
        assert "keyword_classified" in accounts["rootadmin"].get("/docs/Lib/mixed.md").text()

    def test_a_partial_reader_cannot_delete_the_page(self, accounts):
        r = accounts["plain"].delete("/docs/Lib/mixed.md")
        assert r.status == 403

    def test_a_full_reader_round_trips_the_section(self, accounts):
        text = accounts["staffer"].get("/docs/Lib/mixed.md").text()
        assert accounts["staffer"].put("/docs/Lib/mixed.md", text).status == 200
        assert "keyword_classified" in accounts["staffer"].get("/docs/Lib/mixed.md").text()


# --------------------------------------------------------------------------- #
# 8. write access + ACL editing
# --------------------------------------------------------------------------- #
class TestWriteAccess:
    def test_a_reader_can_edit_an_unrestricted_page(self, accounts):
        # Keep the image reference: dropping it would un-reference open-logo.svg,
        # which is exactly what the asset rule reacts to (see TestAssetAccess).
        body = ('<!--meta\n{"title":"Public","description":"open to all"}\n-->\n\n'
                '# Public\n\nkeyword_public edited\n\n![logo](open-logo.svg)\n')
        assert accounts["plain"].put("/docs/Lib/public.md", body).status == 200

    def test_no_write_without_read(self, accounts):
        assert accounts["plain"].put("/docs/Lib/chapter/intro.md", "# hi\n").status == 403

    def test_anonymous_cannot_write(self, accounts):
        assert accounts["anon"].put("/docs/Lib/public.md", "# hi\n").status == 403

    def test_a_non_admin_cannot_add_an_access_block(self, accounts):
        """The heart of it: if an author could write their own ACL, the model would
        be advisory. Adding one needs access-management rights."""
        body = ('<!--meta\n{"title":"Public","access":{"read":["plain-only"]}}\n-->\n\n# Public\n')
        r = accounts["plain"].put("/docs/Lib/public.md", body)
        assert r.status == 403
        assert r.json()["aclChange"] is True

    def test_a_non_admin_cannot_remove_an_access_block(self, accounts):
        body = '<!--meta\n{"title":"Intro","next":["Lib/chapter/middle"]}\n-->\n\n# Intro\n'
        assert accounts["staffer"].put("/docs/Lib/chapter/intro.md", body).status == 403

    def test_a_non_admin_cannot_add_a_restricted_section(self, accounts):
        body = ('<!--meta\n{"title":"Public"}\n-->\n\n# Public\n\n'
                '<!--access start {"read":["staff"]}-->\nx\n<!--access end-->\n')
        assert accounts["plain"].put("/docs/Lib/public.md", body).status == 403

    def test_an_administrator_can_change_an_access_block(self, accounts):
        admin = accounts["rootadmin"]
        body = ('<!--meta\n{"title":"Ops","next":["Lib/merged"],"access":{"read":["ops","staff"]}}\n-->\n\n'
                '# Ops\n\nkeyword_ops\n')
        assert admin.put("/docs/Lib/ops-entry.md", body).status == 200
        assert accounts["staffer"].get("/docs/Lib/ops-entry.md").status == 200
        # put it back so later tests see the original shape
        original = ('<!--meta\n{ "title": "Ops", "next": ["Lib/merged"], "access": { "read": ["ops"] } }\n-->\n\n'
                    '# Ops\n\nkeyword_ops\n')
        assert admin.put("/docs/Lib/ops-entry.md", original).status == 200

    def test_editing_a_page_without_touching_its_acl_is_allowed(self, accounts):
        body = ('<!--meta\n{ "title": "Intro", "next": ["Lib/chapter/middle", "Lib/merged"],'
                ' "access": { "read": ["staff"] } }\n-->\n\n# Intro\n\nkeyword_intro and more\n')
        assert accounts["staffer"].put("/docs/Lib/chapter/intro.md", body).status == 200

    def test_deleting_a_restricted_page_needs_acl_rights(self, accounts):
        assert accounts["staffer"].delete("/docs/Lib/chapter/deep.md").status == 403


# --------------------------------------------------------------------------- #
# 9. administration
# --------------------------------------------------------------------------- #
class TestAdministration:
    def test_only_administrators_may_list_accounts(self, accounts):
        assert accounts["plain"].get("/api/auth/users").status == 403
        assert accounts["rootadmin"].get("/api/auth/users").status == 200

    def test_only_administrators_may_change_groups(self, accounts):
        r = accounts["plain"].post("/api/auth/users/update", {"username": "plain", "groups": ["staff"]})
        assert r.status == 403

    def test_a_group_change_takes_effect_immediately(self, secured, accounts):
        c = secured.client()
        r = accounts["rootadmin"].post("/api/auth/users/create",
                                       {"username": "promoted", "password": "correct-horse-battery"})
        assert r.status == 201
        assert c.login("promoted", "correct-horse-battery").status == 200
        assert c.get("/docs/Lib/chapter/intro.md").status == 403
        assert accounts["rootadmin"].post("/api/auth/users/update",
                                          {"username": "promoted", "groups": ["staff"]}).status == 200
        # The old session is revoked, so the change cannot be outrun by staying
        # signed in; after signing in again the new group applies.
        assert c.get("/api/auth/me").json()["user"] is None
        assert c.login("promoted", "correct-horse-battery").status == 200
        assert c.get("/docs/Lib/chapter/intro.md").status == 200

    def test_unknown_groups_are_not_assignable(self, accounts):
        """Target a throwaway account: a group edit revokes that user's sessions,
        which would sign the shared `plain` client out from under later tests."""
        admin = accounts["rootadmin"]
        assert admin.post("/api/auth/users/create",
                          {"username": "groupprobe", "password": "correct-horse-battery"}).status == 201
        r = admin.post("/api/auth/users/update",
                       {"username": "groupprobe", "groups": ["not-a-real-group", "staff"]})
        assert r.status == 200
        assert r.json()["user"]["groups"] == ["staff"]

    def test_disabling_an_account_blocks_sign_in(self, secured, accounts):
        assert accounts["rootadmin"].post("/api/auth/users/create",
                                          {"username": "tempuser", "password": "correct-horse-battery"}).status == 201
        assert accounts["rootadmin"].post("/api/auth/users/update",
                                          {"username": "tempuser", "disabled": True}).status == 200
        assert secured.client().login("tempuser", "correct-horse-battery").status == 403

    def test_the_last_administrator_cannot_be_demoted(self, accounts):
        r = accounts["rootadmin"].post("/api/auth/users/update", {"username": "rootadmin", "admin": False})
        assert r.status == 400
        assert "last administrator" in r.json()["error"]

    def test_you_cannot_delete_yourself(self, accounts):
        r = accounts["rootadmin"].post("/api/auth/users/delete", {"username": "rootadmin"})
        assert r.status == 400


# --------------------------------------------------------------------------- #
# 10. the account file and other server surfaces
# --------------------------------------------------------------------------- #
class TestServerSurface:
    def test_the_account_file_is_not_served(self, accounts, secured):
        for path in ("/api/auth/users.json", "/auth/users.json", "/docs/Lib/../../auth/users.json",
                     "/../auth/users.json"):
            r = accounts["rootadmin"].get(path)
            assert r.status in (403, 404), path
            assert "passwordHash" not in r.text(), path

    def test_path_traversal_is_still_blocked(self, accounts):
        r = accounts["rootadmin"].get("/docs/Lib/%2e%2e%2f%2e%2e%2fconfig.json")
        assert r.status in (400, 403, 404)
        assert "siteTitle" not in r.text()

    def test_security_headers_are_present(self, secured):
        r = secured.client().get("/")
        assert r.headers.get("X-Content-Type-Options") == "nosniff"
        assert r.headers.get("X-Frame-Options") == "DENY"
        assert "default-src 'self'" in r.headers.get("Content-Security-Policy", "")

    def test_the_csp_has_no_unsafe_inline_scripts(self, secured):
        csp = secured.client().get("/").headers.get("Content-Security-Policy", "")
        script_src = [p for p in csp.split(";") if p.strip().startswith("script-src")][0]
        assert "'unsafe-inline'" not in script_src
        assert "'unsafe-eval'" not in script_src

    def test_the_app_shell_is_served_signed_out(self, secured):
        """The sign-in screen is part of the app, so gating the shell would leave a
        signed-out visitor staring at a blank page."""
        c = secured.client()
        assert c.get("/").status == 200
        assert c.get("/js/main.js").status == 200

    def test_an_oversized_body_is_refused(self, accounts):
        r = accounts["rootadmin"].put("/docs/Lib/huge.md", "x" * (9 * 1024 * 1024))
        assert r.status == 413

    def test_chunked_requests_are_refused(self, accounts):
        r = accounts["rootadmin"].request("PUT", "/docs/Lib/chunky.md", body=b"# hi\n",
                                          headers={"Transfer-Encoding": "chunked"})
        assert r.status == 413

    def test_coverage_hides_restricted_documents(self, accounts):
        cov = accounts["plain"].get("/api/index/coverage").json()
        docs = {r["docId"] for r in cov["requirements"]} | {t["docId"] for t in cov["tests"]}
        assert "Lib/secret" not in docs
        assert "Lib/chapter/intro" not in docs

    def test_access_endpoint_explains_inheritance(self, accounts):
        info = accounts["staffer"].get("/api/index/access?id=Lib/chapter/deep").json()
        assert info["effective"]["read"] == ["staff"]
        assert info["effective"]["explicit"] is False
        assert info["effective"]["inheritedFrom"] == ["Lib/chapter/intro"]
        assert info["canEditAccess"] is False

    def test_access_endpoint_hides_a_hidden_document(self, accounts):
        assert accounts["plain"].get("/api/index/access?id=Lib/secret").status == 404


# --------------------------------------------------------------------------- #
# 11. publicRead
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def public_site(tmp_path_factory):
    s = Server(tmp_path_factory.mktemp("publicread"), {
        "enabled": True, "publicRead": True, "allowRegistration": False,
        "groups": {"staff": {"label": "Staff"}},
    }).start()
    yield s
    s.stop()


class TestPublicRead:
    def test_anonymous_reads_unrestricted_pages(self, public_site):
        assert public_site.client().get("/docs/Lib/public.md").status == 200

    def test_anonymous_still_cannot_read_a_restricted_page(self, public_site):
        assert public_site.client().get("/docs/Lib/chapter/intro.md").status == 403

    def test_anonymous_still_cannot_see_a_hidden_page(self, public_site):
        assert public_site.client().get("/docs/Lib/secret.md").status == 404

    def test_anonymous_cannot_write(self, public_site):
        c = public_site.client()
        c.bootstrap_csrf()
        assert c.put("/docs/Lib/public.md", "# hi\n").status == 403

    def test_registration_stays_closed(self, public_site):
        c = public_site.client()
        c.bootstrap_csrf()
        r = c.post("/api/auth/register", {"username": "sneaky", "password": "correct-horse-battery"})
        assert r.status == 403


# --------------------------------------------------------------------------- #
# 12. regressions found by the security cross-audit
# --------------------------------------------------------------------------- #
class TestAuditRegressions:
    """One test per defect the adversarial audit confirmed. Each names the SHAPE
    of the bypass, so a future change that reintroduces it fails loudly rather
    than quietly."""

    # -- path spelling: the doc id must come from the resolved path ---------
    def test_a_dot_segment_does_not_bypass_the_acl(self, accounts):
        """Built from the URL, `./chapter/intro` was an id no ACL was stored
        under - so the lookup came back "unrestricted" and the file was served."""
        assert accounts["plain"].get("/docs/Lib/./chapter/intro.md").status in (403, 404)

    def test_a_backtracking_path_does_not_bypass_the_acl(self, accounts):
        assert accounts["plain"].get("/docs/Lib/chapter/../chapter/intro.md").status in (403, 404)

    def test_a_case_variant_path_does_not_bypass_the_acl(self, accounts):
        """Windows and macOS open files case-insensitively, so a case-variant URL
        reaches the same bytes under a different dictionary key."""
        r = accounts["plain"].get("/docs/Lib/CHAPTER/INTRO.md")
        assert r.status in (403, 404), r.text()[:200]

    def test_a_case_variant_path_cannot_be_written(self, accounts):
        r = accounts["plain"].put("/docs/Lib/Chapter/Intro.md", "# hi\n")
        assert r.status in (403, 404)

    # -- fail closed --------------------------------------------------------
    def test_hidden_with_no_read_list_still_hides(self, accounts):
        """`{"hidden": true}` alone used to be a no-op: visibility short-circuited
        on read-is-None and returned FULL before ever looking at `hidden`."""
        assert accounts["plain"].get("/docs/Lib/hideonly.md").status == 404
        ids = [n[0] for n in accounts["plain"].get("/api/index/graph").json()["nodes"]]
        assert "Lib/hideonly" not in ids

    def test_a_fence_in_the_meta_header_does_not_disable_redaction(self, accounts):
        """The header is JSON; a ``` inside a description opened a phantom fence
        that swallowed every access marker in the rest of the file."""
        text = accounts["plain"].get("/docs/Lib/fencey.md").text()
        assert "keyword_fenced_secret" not in text
        assert "wd-restricted" in text
        assert accounts["staffer"].get("/docs/Lib/fencey.md").text().count("keyword_fenced_secret") == 1

    def test_a_marker_inside_a_code_fence_is_an_example_not_a_rule(self, accounts):
        text = accounts["plain"].get("/docs/Lib/example.md").text()
        assert "keyword_example_visible" in text
        assert "keyword_after_example" in text
        assert "this is only an example" in text

    def test_an_author_cannot_forge_the_redaction_notice(self, accounts):
        """A forged notice is not merely cosmetic: it lets an author wrap real
        content in a fake one so that cleared readers never see it."""
        text = accounts["plain"].get("/docs/Lib/forger.md").text()
        assert "```wd-restricted\n" not in text
        assert "wd-restricted-example" in text
        assert "keyword_forger_tail" in text

    # -- disclosure ---------------------------------------------------------
    def test_the_access_endpoint_is_not_an_enumeration_oracle(self, accounts):
        """404 for hidden but 200 for nonexistent told a caller which ids exist."""
        hidden = accounts["plain"].get("/api/index/access?id=Lib/secret")
        missing = accounts["plain"].get("/api/index/access?id=Lib/no-such-doc-at-all")
        assert hidden.status == 404
        assert missing.status == 404
        assert hidden.json() == missing.json()

    def test_the_results_sidecar_is_not_served_raw(self, accounts):
        """It has a filtered API; the raw file bypasses that filter entirely."""
        assert accounts["plain"].get("/docs/Lib/.webdoc-tests.json").status in (403, 404)

    def test_status_does_not_publish_the_document_count_before_sign_in(self, accounts):
        st = accounts["anon"].get("/api/index/status").json()
        assert st["docs"] == 0
        assert accounts["plain"].get("/api/index/status").json()["docs"] > 0

    def test_coverage_does_not_name_what_it_filtered_out(self, accounts):
        """The rows were filtered; the cross-reference IDS were not, and a
        requirement id carries its component and group."""
        cov = accounts["plain"].get("/api/index/coverage").json()
        known = {r["id"] for r in cov["requirements"]}
        tests = {t["id"] for t in cov["tests"]}
        for r in cov["requirements"]:
            assert set(r["traceTo"]) <= known
            assert set(r["traceFrom"]) <= known
            assert set(r["verifiedBy"]) <= tests

    # -- the access rule is more than the access block ----------------------
    def test_severing_a_next_edge_needs_acl_rights(self, accounts):
        """`next` is what carries a lock downstream, so on a restricted page the
        link list is part of the access rule."""
        body = ('<!--meta\n{ "title": "Intro", "next": [],'
                ' "access": { "read": ["staff"] } }\n-->\n\n# Intro\n\nkeyword_intro\n')
        r = accounts["staffer"].put("/docs/Lib/chapter/intro.md", body)
        assert r.status == 403
        assert r.json()["aclChange"] is True
        assert accounts["plain"].get("/docs/Lib/chapter/middle.md").status == 403

    # -- account handling ---------------------------------------------------
    def test_registration_counts_successes_against_the_limiter(self, secured):
        """Only counting FAILURES left anonymous account creation unbounded: a
        script could register as fast as it liked as long as each one worked.

        A fresh client per attempt, because a successful registration issues a new
        session and rotates the CSRF token - which is exactly what a script
        churning out accounts would do anyway."""
        statuses = []
        for i in range(8):
            c = secured.client()
            c.bootstrap_csrf()
            statuses.append(c.post("/api/auth/register",
                                   {"username": "floods%d" % i,
                                    "password": "correct-horse-battery"}).status)
        assert 429 in statuses, statuses

    def test_a_forged_csrf_cookie_is_not_echoed_back(self, secured):
        """The value is written into a Set-Cookie header; a stray ';' there
        injects cookie attributes."""
        c = secured.client()
        r = c.request("GET", "/api/auth/me", headers={"Cookie": "wd_csrf=abc; Path=/; Domain=evil"})
        token = r.json()["csrf"]
        assert ";" not in token
        assert token != "abc"

    def test_the_last_administrator_cannot_lose_their_admin_group(self, secured, accounts):
        """admin_count looked only at the per-account FLAG - a different
        definition of "administrator" from the one every access check uses, which
        also honours membership of a configured admin group. With only a
        group-administrator left, the guard did not fire."""
        root = accounts["rootadmin"]
        assert root.post("/api/auth/users/create",
                         {"username": "groupadmin", "password": "correct-horse-battery",
                          "groups": ["admins"]}).status == 201
        # Two administrators now: rootadmin by flag, groupadmin by group.
        ga = secured.client()
        assert ga.login("groupadmin", "correct-horse-battery").status == 200
        assert ga.get("/api/auth/users").status == 200, "group membership should confer admin rights"

        # Disable rootadmin, leaving groupadmin as the only administrator. This
        # also revokes rootadmin's session - a privilege change biting at once.
        assert ga.post("/api/auth/users/update", {"username": "rootadmin", "disabled": True}).status == 200
        r = ga.post("/api/auth/users/update", {"username": "groupadmin", "groups": []})
        assert r.status == 400
        assert "last administrator" in r.json()["error"]

        # Put the fixture back the way we found it.
        assert ga.post("/api/auth/users/update", {"username": "rootadmin", "disabled": False}).status == 200
        assert root.login("rootadmin", "correct-horse-battery").status == 200


# --------------------------------------------------------------------------- #
# 13. regressions the six lenses missed and the completeness critic caught
# --------------------------------------------------------------------------- #
class TestCriticRegressions:
    """Defects that only appear where two components meet: routing and the
    filesystem, parsing and policy, folders and their contents."""

    def test_a_trailing_dot_does_not_route_a_document_as_an_asset(self, accounts):
        """Windows opens `page.md.` as `page.md`, but the string does not END in
        ".md" - so a routing decision made on the URL text sent it down the
        non-Markdown branch, past redaction and onto the looser asset rule."""
        r = accounts["plain"].get("/docs/Lib/mixed.md.")
        assert r.status in (400, 403, 404)
        assert "keyword_classified" not in r.text()

    def test_an_alternate_data_stream_suffix_is_rejected(self, accounts):
        r = accounts["plain"].get("/docs/Lib/mixed.md::$DATA")
        assert r.status in (400, 403, 404)
        assert "keyword_classified" not in r.text()

    def test_a_trailing_space_is_rejected(self, accounts):
        r = accounts["plain"].get("/docs/Lib/mixed.md%20")
        assert r.status in (400, 403, 404)
        assert "keyword_classified" not in r.text()

    def test_a_malformed_meta_header_fails_closed(self, accounts):
        """We cannot know whether the header carried an access rule, so treating
        it as "no rule" means a typo publishes a locked page."""
        assert accounts["plain"].get("/docs/Lib/broken.md").status == 403
        assert accounts["staffer"].get("/docs/Lib/broken.md").status == 403
        assert accounts["rootadmin"].get("/docs/Lib/broken.md").status == 200

    def test_an_asset_beside_no_document_inherits_from_its_ancestors(self, accounts):
        """A folder of nothing but images has no ACL of its own. Falling back to
        "any signed-in account" meant a diagram in a subfolder of a locked
        chapter was public."""
        r = accounts["plain"].get("/docs/Lib/chapter/assets/diagram.svg")
        assert r.status in (403, 404)
        assert "keyword_chapter_asset" not in r.text()
        assert accounts["staffer"].get("/docs/Lib/chapter/assets/diagram.svg").status == 200

    def test_an_asset_in_an_invisible_folder_answers_404_not_403(self, accounts):
        """403 confirms the file exists. In a folder the reader cannot see at
        all, that turns filename guessing into a directory listing."""
        r = accounts["plain"].get("/docs/Lib/sub/anything.png")
        assert r.status == 404

    def test_a_public_asset_is_still_served(self, accounts):
        """The tightening must not break the ordinary case."""
        assert accounts["plain"].get("/docs/Lib/public.md").status == 200

    def test_a_marker_in_an_inline_code_span_is_prose_not_a_rule(self, accounts):
        """An unterminated marker restricts to the end of the file, so treating a
        `<!--access start-->` written inline as real meant that documenting the
        syntax blanked the rest of the page - including in WebDocs' own docs.

        It is also the safer reading: an `<!--access end-->` written inline INSIDE
        a restricted section would otherwise close it early and publish the rest."""
        text = accounts["plain"].get("/docs/Lib/inline.md").text()
        assert "keyword_after_inline_mention" in text
        assert "wd-restricted" not in text


# --------------------------------------------------------------------------- #
# 14. non-document files (images, reports) fetched directly
# --------------------------------------------------------------------------- #
class TestAssetAccess:
    """A file that is not a document carries no metadata, so it borrows its answer
    from the pages that USE it - and only falls back to its folder when nothing
    does. The earlier "strictest neighbour in the folder" rule was both unusable
    (one locked page at a source root hid every logo at that level) and imprecise."""

    def test_an_image_used_by_a_public_page_is_served(self, accounts):
        r = accounts["plain"].get("/docs/Lib/open-logo.svg")
        assert r.status == 200
        assert "PUBLIC_IMAGE_BYTES" in r.text()

    def test_that_image_still_needs_a_sign_in(self, accounts):
        assert accounts["anon"].get("/docs/Lib/open-logo.svg").status in (403, 404)

    def test_an_image_used_only_by_a_locked_page_is_withheld(self, accounts):
        r = accounts["plain"].get("/docs/Lib/chapter/assets/secret-diagram.svg")
        assert r.status in (403, 404)
        assert "LOCKED_IMAGE_BYTES" not in r.text()

    def test_a_member_gets_that_image(self, accounts):
        r = accounts["staffer"].get("/docs/Lib/chapter/assets/secret-diagram.svg")
        assert r.status == 200
        assert "LOCKED_IMAGE_BYTES" in r.text()

    def test_an_unreferenced_file_falls_back_to_its_folder(self, accounts):
        """Nothing in the app can surface it, so the strict rule costs nobody
        anything: every document in the nearest folder above it must be readable."""
        r = accounts["plain"].get("/docs/Lib/chapter/assets/diagram.svg")
        assert r.status in (403, 404)
        assert "keyword_chapter_asset" not in r.text()
        assert accounts["staffer"].get("/docs/Lib/chapter/assets/diagram.svg").status == 200

    def test_moving_a_page_behind_a_lock_takes_its_images_with_it(self, accounts):
        """The rule has to track edits, not just the initial state."""
        admin = accounts["rootadmin"]
        assert accounts["plain"].get("/docs/Lib/open-logo.svg").status == 200
        locked = ('<!--meta\n{ "title": "Public", "description": "open to all",'
                  ' "access": { "read": ["ops"] } }\n-->\n\n'
                  '# Public\n\nkeyword_public\n\n![logo](open-logo.svg)\n')
        assert admin.put("/docs/Lib/public.md", locked).status == 200
        try:
            assert accounts["plain"].get("/docs/Lib/open-logo.svg").status in (403, 404)
            assert accounts["opsuser"].get("/docs/Lib/open-logo.svg").status == 200
        finally:
            original = ('<!--meta\n{ "title": "Public", "description": "open to all" }\n-->\n\n'
                        '# Public\n\nEveryone may read this. keyword_public\n\n'
                        '![logo](open-logo.svg)\n')
            assert admin.put("/docs/Lib/public.md", original).status == 200
        assert accounts["plain"].get("/docs/Lib/open-logo.svg").status == 200
