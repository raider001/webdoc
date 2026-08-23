#!/usr/bin/env python3
"""webdoc_auth.py - stdlib-only accounts, sessions and request authentication.

Companion to serve.py / webdoc_index.py, written against the same constraints:
Python standard library ONLY (no third-party packages, no Node, no build step).
It owns four things and nothing else:

  * UserStore     - the on-disk account file (JSON), PBKDF2 password hashing.
  * SessionStore  - in-memory session tokens (never persisted: a restart signs
                    everyone out, which is the safe default for a doc server).
  * RateLimiter   - per-IP and per-username backoff for login / registration.
  * AuthConfig    - the parsed `auth` block of config.json + the Principal type
                    every access decision in webdoc_access.py is made against.

Authorisation (who may read/modify WHICH document) lives in webdoc_access.py;
this module only answers "who is this request".

DISABLED BY DEFAULT. With no `auth` block in config.json, AuthConfig.enabled is
False and serve.py behaves exactly as it did before accounts existed - anonymous
callers get full read AND write access. Nothing here is on the request path
until an operator opts in.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time

# ---- cookie / header names -------------------------------------------------
SESSION_COOKIE = "wd_session"
CSRF_COOKIE = "wd_csrf"            # readable by JS on purpose (double-submit)
CSRF_HEADER = "X-WebDoc-CSRF"

# ---- password hashing ------------------------------------------------------
# PBKDF2-HMAC-SHA256 via hashlib (OpenSSL-backed C implementation). Chosen over
# scrypt/argon2 for portability: hashlib.scrypt needs an OpenSSL build that
# exposes it, and argon2 is third-party. Iterations are configurable so an
# operator can trade login latency for cost.
HASH_SCHEME = "pbkdf2_sha256"
DEFAULT_ITERATIONS = 210000
MIN_ITERATIONS = 50000
SALT_BYTES = 16
KEY_BYTES = 32

# Passwords longer than this are rejected outright rather than hashed: PBKDF2
# cost does not grow with input length, but accepting unbounded input is free
# memory pressure for an attacker.
MAX_PASSWORD_LENGTH = 1024

USERNAME_RE = re.compile(r'^[A-Za-z0-9](?:[A-Za-z0-9._-]{1,30}[A-Za-z0-9])$')
GROUP_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9 ._-]{0,30}[A-Za-z0-9]$')
CONTROL_RE = re.compile(r'[\x00-\x1f\x7f]')
# The exact shape of a token this module issues (secrets.token_urlsafe). Used to
# validate a token handed BACK by a client before it is written into a Set-Cookie
# header - it is attacker-controlled, and a stray ';' there injects cookie
# attributes.
TOKEN_RE = re.compile(r'^[A-Za-z0-9_-]{16,128}$')


def b64e(raw):
    return base64.b64encode(raw).decode("ascii")


def b64d(text):
    return base64.b64decode(text.encode("ascii"))


def hash_password(password, iterations=DEFAULT_ITERATIONS, salt=None):
    """-> 'pbkdf2_sha256$<iterations>$<salt_b64>$<key_b64>'."""
    iterations = max(MIN_ITERATIONS, int(iterations))
    salt = salt if salt is not None else secrets.token_bytes(SALT_BYTES)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, KEY_BYTES)
    return "%s$%d$%s$%s" % (HASH_SCHEME, iterations, b64e(salt), b64e(key))


def verify_password(password, stored):
    """Constant-time verify against a stored hash string. False on any malformed
    input - never raises, so a corrupt account file cannot become an auth bypass."""
    try:
        scheme, iters, salt_b64, key_b64 = str(stored).split("$", 3)
        if scheme != HASH_SCHEME:
            return False
        salt, expected = b64d(salt_b64), b64d(key_b64)
        got = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iters), len(expected))
    except Exception:
        return False
    return hmac.compare_digest(got, expected)


# A throwaway hash per iteration count, used to spend the SAME CPU time when the
# username does not exist as when it does - otherwise login response time leaks
# which usernames are registered.
_dummy_lock = threading.Lock()
_dummy_hashes = {}


def _dummy_hash(iterations):
    with _dummy_lock:
        h = _dummy_hashes.get(iterations)
        if h is None:
            h = hash_password(secrets.token_urlsafe(24), iterations)
            _dummy_hashes[iterations] = h
        return h


def burn_password_time(iterations):
    """Spend a verification's worth of CPU on a hash that cannot match."""
    verify_password("x" * 24, _dummy_hash(iterations))


# ---- validation ------------------------------------------------------------
def normalize_username(name):
    return str(name or "").strip().casefold()


def normalize_group(name):
    return str(name or "").strip().casefold()


def normalize_groups(names):
    """-> a sorted, de-duplicated tuple of casefolded group names."""
    out = set()
    for n in (names or []):
        g = normalize_group(n)
        if g:
            out.add(g)
    return tuple(sorted(out))


def validate_username(name):
    """-> (ok, message). Length/charset only; uniqueness is the store's job."""
    raw = str(name or "").strip()
    if not raw:
        return False, "A username is required."
    if len(raw) < 3 or len(raw) > 32:
        return False, "Usernames must be 3-32 characters."
    if not USERNAME_RE.match(raw):
        return False, ("Usernames may use letters, digits, dot, dash and underscore, "
                       "and must start and end with a letter or digit.")
    return True, ""


def validate_password(password, min_length=10):
    raw = str(password or "")
    if len(raw) < min_length:
        return False, "Passwords must be at least %d characters." % min_length
    if len(raw) > MAX_PASSWORD_LENGTH:
        return False, "That password is too long."
    if CONTROL_RE.search(raw):
        return False, "Passwords may not contain control characters."
    return True, ""


def clean_display_name(name, fallback):
    raw = CONTROL_RE.sub("", str(name or "")).strip()
    return raw[:64] or fallback


# ---- users -----------------------------------------------------------------
class UserStore:
    """The account file: a small JSON document, rewritten atomically under a lock.

    Deliberately a flat file rather than a table in the SQLite index: that index
    is a DISPOSABLE CACHE that gets dropped and rebuilt on any schema change, and
    accounts must never be collateral damage of a rebuild.
    """

    def __init__(self, path, iterations=DEFAULT_ITERATIONS):
        self.path = os.path.abspath(path)
        self.iterations = max(MIN_ITERATIONS, int(iterations))
        self._lock = threading.RLock()
        self._users = {}          # username_lc -> record
        # Owner-only directory too: the file is 0600, but a traversable parent
        # still lets a local user stat and watch for the temp file.
        try:
            os.makedirs(os.path.dirname(self.path) or ".", mode=0o700, exist_ok=True)
        except OSError:
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        self._load()

    # -- persistence --
    def _load(self):
        with self._lock:
            try:
                with open(self.path, encoding="utf-8") as fh:
                    data = json.load(fh)
            except FileNotFoundError:
                self._users = {}
                return
            except (OSError, ValueError) as e:
                # Refuse to run on an unreadable account file rather than starting
                # with zero users (which would re-open registration bootstrap and
                # hand the next visitor an admin account).
                raise RuntimeError("could not read the account file %s: %s" % (self.path, e))
            users = {}
            for rec in (data.get("users") or []):
                lc = normalize_username(rec.get("username"))
                if not lc:
                    continue
                users[lc] = {
                    "username": str(rec.get("username") or lc),
                    "displayName": clean_display_name(rec.get("displayName"), str(rec.get("username") or lc)),
                    "passwordHash": str(rec.get("passwordHash") or ""),
                    "groups": list(normalize_groups(rec.get("groups"))),
                    "admin": bool(rec.get("admin")),
                    "disabled": bool(rec.get("disabled")),
                    "created": rec.get("created") or "",
                    "lastLogin": rec.get("lastLogin") or "",
                }
            self._users = users

    def _save(self):
        with self._lock:
            payload = {"version": 1, "users": [self._users[k] for k in sorted(self._users)]}
            tmp = self.path + ".tmp"
            # Create the temp file owner-only BEFORE a byte of it exists. Writing
            # it at the process umask and chmod-ing afterwards left the hashes
            # world-readable for the whole write - and touch_login rewrites this
            # file on every single login, so that window reopened constantly.
            try:
                fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                handle = os.fdopen(fd, "w", encoding="utf-8")
            except OSError:
                handle = open(tmp, "w", encoding="utf-8")   # exotic filesystem: still write
            with handle as fh:
                json.dump(payload, fh, indent=2)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, self.path)

    # -- reads --
    def count(self):
        with self._lock:
            return len(self._users)

    def get(self, username):
        with self._lock:
            rec = self._users.get(normalize_username(username))
            return dict(rec) if rec else None

    def list_users(self):
        with self._lock:
            return [public_user(dict(self._users[k])) for k in sorted(self._users)]

    # -- writes --
    def create(self, username, password, display_name=None, groups=(), admin=False,
               disabled=False, first_only_admin=False):
        """-> (record, None) or (None, message).

        `first_only_admin` makes the bootstrap decision INSIDE the lock: two
        concurrent registrations on an empty server both read count()==0 and both
        became administrators otherwise.
        """
        ok, msg = validate_username(username)
        if not ok:
            return None, msg
        lc = normalize_username(username)
        # Hash outside the lock: PBKDF2 is deliberately slow, and holding the
        # store lock across it stalls every other request that touches an account.
        password_hash = hash_password(password, self.iterations)
        with self._lock:
            if lc in self._users:
                return None, "That username is already taken."
            if first_only_admin:
                admin = not self._users
            rec = {
                "username": str(username).strip(),
                "displayName": clean_display_name(display_name, str(username).strip()),
                "passwordHash": password_hash,
                "groups": list(normalize_groups(groups)),
                "admin": bool(admin),
                "disabled": bool(disabled),
                "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "lastLogin": "",
            }
            self._users[lc] = rec
            self._save()
            return dict(rec), None

    def verify(self, username, password):
        """-> (record, None) or (None, reason). Spends the same CPU on an unknown
        username as on a known one so response time reveals nothing."""
        lc = normalize_username(username)
        with self._lock:
            rec = self._users.get(lc)
            stored = rec["passwordHash"] if rec else None
        if not rec or not stored:
            burn_password_time(self._typical_iterations())
            return None, "invalid"
        if not verify_password(password, stored):
            return None, "invalid"
        if rec.get("disabled"):
            return None, "disabled"
        return dict(rec), None

    def _typical_iterations(self):
        """The iteration count a REAL stored hash uses, so the unknown-username
        path costs the same as the known one. Raising pbkdf2Iterations does not
        re-hash existing accounts, so burning at the configured cost after such a
        change would make an unknown username measurably slower - a username
        oracle created by tightening a security setting."""
        with self._lock:
            for rec in self._users.values():
                try:
                    return int(str(rec.get("passwordHash", "")).split("$")[1])
                except (IndexError, ValueError):
                    continue
        return self.iterations

    def _mutate(self, username, fn):
        lc = normalize_username(username)
        with self._lock:
            rec = self._users.get(lc)
            if not rec:
                return None
            fn(rec)
            self._save()
            return dict(rec)

    def set_password(self, username, password):
        digest = hash_password(password, self.iterations)   # slow: do it outside the lock
        return self._mutate(username, lambda r: r.update(passwordHash=digest))

    def set_groups(self, username, groups):
        return self._mutate(username, lambda r: r.update(groups=list(normalize_groups(groups))))

    def set_admin(self, username, is_admin):
        return self._mutate(username, lambda r: r.update(admin=bool(is_admin)))

    def set_disabled(self, username, disabled):
        return self._mutate(username, lambda r: r.update(disabled=bool(disabled)))

    def set_display_name(self, username, name):
        return self._mutate(username, lambda r: r.update(
            displayName=clean_display_name(name, r.get("username"))))

    def touch_login(self, username):
        return self._mutate(username, lambda r: r.update(
            lastLogin=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())))

    def delete(self, username):
        lc = normalize_username(username)
        with self._lock:
            if lc not in self._users:
                return False
            del self._users[lc]
            self._save()
            return True

    def admin_count(self, admin_groups=()):
        """Live administrators, by the SAME definition make_principal uses: the
        per-account flag OR membership of a configured admin group. Counting only
        the flag let the last-administrator guard fire (or fail to fire) on a
        different set of people from the one that actually holds the rights."""
        groups = frozenset(normalize_groups(admin_groups))
        with self._lock:
            return sum(1 for r in self._users.values()
                       if not r.get("disabled")
                       and (r.get("admin") or (groups & frozenset(r.get("groups") or ()))))


def public_user(rec):
    """The subset of an account safe to send to a browser (never the hash)."""
    return {
        "username": rec.get("username"),
        "displayName": rec.get("displayName"),
        "groups": list(rec.get("groups") or []),
        "admin": bool(rec.get("admin")),
        "disabled": bool(rec.get("disabled")),
        "created": rec.get("created") or "",
        "lastLogin": rec.get("lastLogin") or "",
    }


# ---- sessions --------------------------------------------------------------
class SessionStore:
    """In-memory sessions keyed by SHA-256 of the token.

    Storing the digest (not the token) means a heap dump, a crash log or an
    accidental repr of this structure yields nothing an attacker can replay.
    """

    def __init__(self, idle_seconds=8 * 3600, absolute_seconds=30 * 24 * 3600, max_sessions=20000):
        self.idle = int(idle_seconds)
        self.absolute = int(absolute_seconds)
        self.max_sessions = int(max_sessions)
        self._lock = threading.RLock()
        self._by_digest = {}

    @staticmethod
    def _digest(token):
        return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()

    def create(self, username):
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        now = time.time()
        with self._lock:
            if len(self._by_digest) >= self.max_sessions:
                self._sweep_locked(now, force=True)
            self._by_digest[self._digest(token)] = {
                "username": username, "user_lc": normalize_username(username),
                "csrf": csrf, "created": now, "seen": now,
            }
        return token, csrf

    def get(self, token, touch=True):
        """-> a copy of the live session, or None.

        `touch=False` reads WITHOUT refreshing the idle clock. The app polls the
        index status every few seconds; counting that as activity made
        sessionIdleMinutes unreachable - the session never went idle while a tab
        was merely open."""
        if not token:
            return None
        now = time.time()
        d = self._digest(token)
        with self._lock:
            sess = self._by_digest.get(d)
            if not sess:
                return None
            if now - sess["seen"] > self.idle or now - sess["created"] > self.absolute:
                del self._by_digest[d]
                return None
            if touch:
                sess["seen"] = now
            return dict(sess)

    def destroy(self, token):
        with self._lock:
            self._by_digest.pop(self._digest(token), None)

    def destroy_user(self, username):
        """Drop every session of one account - used when groups, password or the
        disabled flag change, so a privilege edit takes effect immediately."""
        lc = normalize_username(username)
        with self._lock:
            for d in [k for k, v in self._by_digest.items() if v["user_lc"] == lc]:
                del self._by_digest[d]

    def destroy_all(self):
        with self._lock:
            self._by_digest.clear()

    def sweep(self):
        with self._lock:
            self._sweep_locked(time.time())

    def _sweep_locked(self, now, force=False):
        for d in [k for k, v in self._by_digest.items()
                  if now - v["seen"] > self.idle or now - v["created"] > self.absolute]:
            del self._by_digest[d]
        if force and len(self._by_digest) >= self.max_sessions:
            # Still full of live sessions: evict the least recently seen.
            oldest = sorted(self._by_digest.items(), key=lambda kv: kv[1]["seen"])
            for d, _ in oldest[: max(1, len(oldest) // 10)]:
                del self._by_digest[d]

    def count(self):
        with self._lock:
            return len(self._by_digest)


# ---- rate limiting ---------------------------------------------------------
class RateLimiter:
    """Sliding-window failure counter with a lockout, keyed by an arbitrary
    string (an IP, a username). Bounded: the key table is pruned so an attacker
    rotating usernames cannot grow it without limit."""

    def __init__(self, max_failures=8, window_seconds=300, lock_seconds=300, max_keys=8192):
        self.max_failures = int(max_failures)
        self.window = int(window_seconds)
        self.lock_seconds = int(lock_seconds)
        self.max_keys = int(max_keys)
        self._lock = threading.RLock()
        self._hits = {}       # key -> [timestamps within the counting window]
        self._locked = {}     # key -> the moment the lockout ends

    def retry_after(self, key):
        """0 when the key may proceed, else the seconds it must wait.

        The lockout is a DEADLINE stamped when the threshold is crossed, not a
        value derived from the failure timestamps. Deriving it made the two
        settings interfere: a `lockoutSeconds` longer than the counting window
        expired early (the failures were pruned out from under it), and one
        shorter than the window over-locked. Both are surprising, and both make
        the number in the 429 body a lie.
        """
        now = time.time()
        with self._lock:
            until = self._locked.get(key)
            if until is not None:
                if now < until:
                    return max(1, int(until - now))
                del self._locked[key]        # served the sentence; start clean
                self._hits.pop(key, None)
            return 0

    def fail(self, key):
        now = time.time()
        with self._lock:
            if len(self._hits) > self.max_keys:
                self._prune_locked(now)
            hits = [t for t in self._hits.get(key, []) if now - t < self.window]
            hits.append(now)
            self._hits[key] = hits
            if len(hits) >= self.max_failures:
                self._locked[key] = now + self.lock_seconds

    def reset(self, key):
        with self._lock:
            self._hits.pop(key, None)
            self._locked.pop(key, None)

    def _prune_locked(self, now):
        for k in [k for k, v in self._hits.items() if not v or now - v[-1] > self.window]:
            if self._locked.get(k, 0) <= now:    # never drop a live lockout
                del self._hits[k]
                self._locked.pop(k, None)
        for k in [k for k, until in self._locked.items() if until <= now]:
            del self._locked[k]
        if len(self._hits) > self.max_keys:      # still oversized: drop the stalest half
            stale = sorted(self._hits.items(), key=lambda kv: kv[1][-1])
            for k, _ in stale[: len(stale) // 2]:
                if self._locked.get(k, 0) <= now:
                    del self._hits[k]


# ---- principal + config ----------------------------------------------------
class Principal:
    """Who a request is: an authenticated account, or the anonymous visitor.

    `groups` is always a frozenset of CASEFOLDED names, so every membership test
    in webdoc_access.py is a plain set intersection with no casing surprises.
    """

    __slots__ = ("username", "display_name", "groups", "admin", "authenticated")

    def __init__(self, username=None, display_name=None, groups=(), admin=False, authenticated=False):
        self.username = username
        self.display_name = display_name or username or "Guest"
        self.groups = frozenset(normalize_groups(groups))
        self.admin = bool(admin)
        self.authenticated = bool(authenticated)

    def in_any(self, groups):
        if self.admin:
            return True
        return bool(self.groups & frozenset(groups or ()))

    def to_json(self):
        return {
            "username": self.username, "displayName": self.display_name,
            "groups": sorted(self.groups), "admin": self.admin,
            "authenticated": self.authenticated,
        }


ANONYMOUS = Principal()


class AuthConfig:
    """The parsed `auth` block of config.json.

    Every field has a default that preserves the pre-accounts behaviour, and the
    whole feature is off unless `enabled` is explicitly true.
    """

    def __init__(self, raw, here):
        raw = raw if isinstance(raw, dict) else {}
        self.enabled = bool(raw.get("enabled", False))
        self.allow_registration = bool(raw.get("allowRegistration", True))
        self.require_approval = bool(raw.get("requireApproval", False))
        self.first_user_is_admin = bool(raw.get("firstUserIsAdmin", True))
        # Unrestricted documents readable without signing in.
        self.public_read = bool(raw.get("publicRead", False))

        self.admin_groups = normalize_groups(raw.get("adminGroups") or ["admins"])
        self.default_groups = normalize_groups(raw.get("defaultGroups") or [])
        self.anonymous_groups = normalize_groups(raw.get("anonymousGroups") or [])
        # Who may modify a document that carries no explicit write ACL.
        # None (the default) = any signed-in account, matching the old behaviour
        # once you are past the sign-in wall.
        wg = raw.get("writeGroups", None)
        self.write_groups = normalize_groups(wg) if isinstance(wg, list) else None
        # Who may CHANGE an access block (doc-level or section-level). Defaults to
        # the admin groups: without this, anyone who can edit a page could widen
        # its own permissions, which would make the whole ACL model advisory.
        ag = raw.get("aclGroups", None)
        self.acl_groups = normalize_groups(ag) if isinstance(ag, list) else None

        self.groups = {}
        raw_groups = raw.get("groups")
        if isinstance(raw_groups, dict):
            for name, spec in raw_groups.items():
                key = normalize_group(name)
                if not key or not GROUP_RE.match(str(name).strip()):
                    continue
                spec = spec if isinstance(spec, dict) else {}
                self.groups[key] = {
                    "name": key,
                    "label": clean_display_name(spec.get("label"), str(name).strip()),
                    "description": clean_display_name(spec.get("description"), "")[:200],
                    "color": _clean_color(spec.get("color")),
                }
        elif isinstance(raw_groups, list):
            for name in raw_groups:
                key = normalize_group(name)
                if key and GROUP_RE.match(str(name).strip()):
                    self.groups[key] = {"name": key, "label": str(name).strip(), "description": "", "color": None}
        for key in list(self.admin_groups) + list(self.default_groups) + list(self.anonymous_groups):
            self.groups.setdefault(key, {"name": key, "label": key, "description": "", "color": None})

        self.session_idle_minutes = _clamp_int(raw.get("sessionIdleMinutes", 480), 5, 60 * 24 * 30)
        self.session_max_hours = _clamp_int(raw.get("sessionMaxHours", 720), 1, 24 * 365)
        self.password_min_length = _clamp_int(raw.get("passwordMinLength", 10), 8, 128)
        self.pbkdf2_iterations = _clamp_int(raw.get("pbkdf2Iterations", DEFAULT_ITERATIONS), MIN_ITERATIONS, 5000000)
        self.cookie_secure = bool(raw.get("cookieSecure", False))
        self.max_login_failures = _clamp_int(raw.get("maxLoginFailures", 8), 3, 1000)
        self.lockout_seconds = _clamp_int(raw.get("lockoutSeconds", 300), 5, 86400)
        # Peers whose X-Forwarded-For may be believed. Empty by default: trusting
        # that header from anyone lets a caller mint a fresh identity per attempt
        # and walk straight past the rate limiter. Set it to your reverse proxy's
        # address, or leave it empty and accept that everything behind a proxy
        # shares one bucket.
        tp = raw.get("trustedProxies")
        self.trusted_proxies = frozenset(str(p).strip() for p in tp if str(p).strip()) \
            if isinstance(tp, list) else frozenset()
        self.security_headers = bool(raw.get("securityHeaders", True))
        self.content_security_policy = raw.get("contentSecurityPolicy", None)

        users_file = raw.get("usersFile") or os.path.join(".webdoc-auth", "users.json")
        self.users_file = os.path.abspath(os.path.join(here, users_file))
        self.auth_dir = os.path.dirname(self.users_file)

    def group_label(self, name):
        g = self.groups.get(normalize_group(name))
        return g["label"] if g else str(name)

    def known_groups(self):
        return sorted(self.groups.keys())

    def is_admin_groups(self, groups):
        return bool(frozenset(groups or ()) & frozenset(self.admin_groups))

    def acl_editor_groups(self):
        return self.acl_groups if self.acl_groups is not None else self.admin_groups

    def to_json(self):
        """What /site.json publishes: enough for the UI to render sign-in and the
        group legend, and nothing about any individual account."""
        return {
            "enabled": self.enabled,
            "allowRegistration": self.enabled and self.allow_registration,
            "requireApproval": self.require_approval,
            "publicRead": self.public_read,
            "passwordMinLength": self.password_min_length,
            "groups": [self.groups[k] for k in sorted(self.groups)],
            "adminGroups": list(self.admin_groups),
        }


def _clamp_int(value, low, high):
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = low
    return max(low, min(high, n))


_COLOR_RE = re.compile(r'^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')


def _clean_color(value):
    """Only a literal hex colour is accepted - this string is handed to the
    browser and used in CSS, so nothing else may pass through."""
    v = str(value or "").strip()
    return v if _COLOR_RE.match(v) else None


def make_principal(cfg, user_record):
    """Build a Principal from an account record, folding config admin-groups and
    the per-account admin flag into one `admin` decision."""
    groups = normalize_groups(user_record.get("groups"))
    admin = bool(user_record.get("admin")) or cfg.is_admin_groups(groups)
    return Principal(
        username=user_record.get("username"),
        display_name=user_record.get("displayName"),
        groups=groups, admin=admin, authenticated=True,
    )


def anonymous_principal(cfg):
    return Principal(groups=cfg.anonymous_groups) if cfg.anonymous_groups else ANONYMOUS


# ---- cookies ---------------------------------------------------------------
def parse_cookies(header):
    """Minimal Cookie: header parser (http.cookies raises on some real-world input)."""
    out = {}
    for part in str(header or "").split(";"):
        name, sep, value = part.partition("=")
        if not sep:
            continue
        out[name.strip()] = value.strip().strip('"')
    return out


def cookie_header(name, value, max_age=None, http_only=True, secure=False, same_site="Strict", path="/"):
    bits = ["%s=%s" % (name, value), "Path=" + path, "SameSite=" + same_site]
    if http_only:
        bits.append("HttpOnly")
    if secure:
        bits.append("Secure")
    if max_age is not None:
        bits.append("Max-Age=%d" % int(max_age))
    return "; ".join(bits)


def clear_cookie_header(name, secure=False, http_only=True, path="/"):
    return cookie_header(name, "", max_age=0, http_only=http_only, secure=secure, path=path)
