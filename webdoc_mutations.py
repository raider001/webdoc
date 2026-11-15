"""Interactive handlers. Never imported in global read-only mode."""
import os
import re
import json
import threading
import urllib.parse
import webdoc_access
import webdoc_auth
import webdoc_index
from serve import safe_join, blocked_path, MAX_DOC_BODY, MAX_JSON_BODY, MAX_AUTH_BODY

class MutationHandler:
    def _auth_register(self):
        cfg = self.config["auth"]
        if not cfg.allow_registration:
            self._drain_early_body()
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
        # Approval and non-admin defaults apply even to the first registrant.
        disabled = bool(cfg.require_approval)
        rec, err = self.users.create(username, password, display,
                                     groups=[g for g in cfg.default_groups if g not in cfg.admin_groups], disabled=disabled,
                                     admin=False)
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


    def _runs_post(self):
        # Consume the bounded body before refusal so unread bytes cannot reset TCP.
        body = self._read_json()
        # Origin must be present, canonical and match the server's own origin.
        origin = self.headers.get("Origin", "")
        scheme = "https" if self.config["auth"].cookie_secure else "http"
        if (origin != scheme + "://" + self.headers.get("Host", "")
                or self.headers.get("X-WebDoc-Run") != "1"):
            return self._json(403, {"error": "same Origin and X-WebDoc-Run: 1 required"})
        if not self.config["auth"].enabled:
            try: hostname = urllib.parse.urlsplit(origin).hostname
            except ValueError: hostname = None
            if hostname not in ("127.0.0.1", "localhost", "::1"):
                return self._json(403, {"error": "local runner requires a local host origin"})
        if not self._guard_mutation(): return
        if not isinstance(body, dict) or set(body) != {"source", "ids"}:
            return self._json(400, {"error": "only source and ids accepted"})
        source = body["source"]
        if not isinstance(source, str) or not self._source(source):
            return self._json(400, {"error": "unknown source"})
        if self.config.get("projects"):
            owner = next((p for p in self.config["projects"] if any(s["name"] == source for s in p["sources"])), None)
            if not owner or owner["name"] != self.project["name"]:
                return self._not_found()
        if not self._can_write_source(source): return self._deny(what="test runs")
        try:
            if self.runs is None: raise ValueError("test running unavailable")
            described = self._run_described(source, write=True)
            if not isinstance(body["ids"], list) or not self._may_run(source, body["ids"], described):
                return self._deny(what="test runs")
            rid = self.runs.submit(source, body["ids"], described)
            return self._json(202, {"id": rid, "state": "waiting"})
        except (ValueError, TypeError) as exc:
            return self._json(400, {"error": "request failed"})


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
            return self._json(400, {"error": "request failed"})
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
            return self._json(500, {"error": "request failed"})
        return self._json(200, {"ok": True})


    def _check_write(self, doc_id, fspath, body):
        """Authorise one document write. -> None to proceed, or a truthy sent
        response (see _send/_json) that the caller must return on immediately.

        Two separate gates, deliberately:
          1. WRITE rights on the document (inherited down `next` like read rights).
          2. ACL-EDIT rights, but only if this write CHANGES an access block.
        Without (2) the whole model would be advisory: anyone able to edit a locked
        page could simply delete its `access` block and publish it.
        """
        src = self._source(doc_id.split("/", 1)[0])
        if src and src.get("readOnly"):
            return self._json(403, {"error": "source is read-only"})
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
        if src and blocked_path(src, rel):
            return self._not_found()
        if not src:
            return self._json(404, {"error": f"unknown source '{name}'"})
        if not rel or not rel.lower().endswith(".md"):
            return self._json(400, {"error": "path must be a .md file"})
        fspath = safe_join(src["path"], rel)
        if not fspath:
            return self._not_found()
        if self._acl_blocked():
            return self._not_ready()
        doc_id = self._doc_id_for(src, fspath)
        body = self._read_body(self.config.get("maxDocBodyBytes", MAX_DOC_BODY))
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
                return self._json(500, {"error": "request failed"})
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
        src = self._source(doc_id.split("/", 1)[0])
        if src and src.get("readOnly"):
            return self._json(403, {"error": "source is read-only"})
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
        if src and blocked_path(src, rel):
            return self._not_found()
        if not src:
            return self._json(404, {"error": f"unknown source '{name}'"})
        if not rel or not rel.lower().endswith(".md"):
            return self._json(400, {"error": "path must be a .md file"})
        fspath = safe_join(src["path"], rel)
        if not fspath:
            return self._not_found()
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
                return self._json(500, {"error": "request failed"})
            if self.index:
                try:
                    self.index.delete_doc(name, canon_rel)
                except Exception as e:
                    print("  ! index delete failed:", e)
        return self._json(200, {"ok": True, "id": doc_id, "deleted": True})
