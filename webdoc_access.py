#!/usr/bin/env python3
"""webdoc_access.py - the authorisation model: which documents and which
sections of a document a Principal may read or modify.

webdoc_auth.py answers "who is this request". This module answers "what may
they see". It is pure, stdlib-only and DOM-free so the whole policy can be unit
tested without a server.

THREE THINGS ARE DECLARED IN THE DOCUMENT ITSELF
------------------------------------------------
1. A document-level ACL, in the existing `<!--meta {...}-->` header:

       <!--meta
       { "title": "Release process",
         "next": ["Docs/deploy"],
         "access": { "read": ["staff"], "write": ["release"], "hidden": false } }
       -->

2. A section-level ACL, as a paired HTML comment in the body. Deliberately a
   DIFFERENT marker from the `<!--meta start ...-->` pair used by requirement
   groups and test cases, because those swallow their inner content on render
   and a restricted section must render normally for anyone allowed to see it:

       <!--access start {"read": ["staff"], "label": "Internal steps"}-->
       ... markdown ...
       <!--access end-->

3. Nothing else. There is no separate ACL database to drift out of step with the
   files, and an ACL travels with its document through git, moves and backups.

RECURSIVE PROPAGATION
---------------------
An ACL applies to the document that declares it AND, recursively, to everything
reachable from it through `next` ("Recommended next") - so locking the entry
point of a chapter locks the chapter. Propagation is monotonic (group sets only
grow) so cycles terminate, and it is a UNION: a document reachable from two
restricted parents is readable by either parent's groups, because a reader who
was allowed to walk that path must be able to keep walking it. Any document that
declares its own `read` stops inheriting one.

FAIL CLOSED
-----------
Every ambiguity resolves toward LESS access: an unparsable access block
restricts rather than opens, an unterminated `<!--access start-->` redacts to
the end of the file, and a document whose effective ACL cannot be computed is
treated as restricted to nobody but administrators.
"""
import json
import re

from webdoc_auth import normalize_groups, normalize_group

# ---- markers ---------------------------------------------------------------
ACCESS_TOKEN_RE = re.compile(r'<!--\s*access\s+(start|end)\b\s*(\{.*?\})?\s*-->', re.I | re.S)
FENCE_OPEN_RE = re.compile(r'^ {0,3}([`~]{3,})')
FENCE_CLOSE_RE = re.compile(r'^ {0,3}([`~]{3,})[ \t]*$')

# The fenced block a redacted section is replaced with. Rendered by the browser
# as a "restricted" notice; if that renderer is ever absent it degrades to an
# ordinary code block, which shows the reader that something was withheld and
# leaks nothing.
REDACTED_LANG = "wd-restricted"

# A section whose access block will not parse is redacted from everyone but an
# administrator, rather than being shown to everyone.
UNPARSABLE = ("\x00unparsable",)

# An author-written ```wd-restricted fence. Only the SERVER may emit one, so any
# that arrives from a document is renamed before the real ones are inserted.
FORGED_NOTICE_RE = re.compile(r'^([ ]{0,3}(?:`{3,}|~{3,}))[ \t]*' + REDACTED_LANG + r'\b', re.M)

# A document's own <!--meta {...}--> header. It is split off before any fence
# scan: the header is JSON, and a value inside it that happens to begin with ```
# would otherwise open a phantom code fence that swallowed every access marker in
# the file - silently disabling redaction for that whole document. The `{` right
# after `meta` is what distinguishes a header from a <!--meta start ...--> block.
DOC_HEADER_RE = re.compile(r'^﻿?\s*<!--\s*meta\s*\{.*?\}\s*-->', re.S)


def split_header(text):
    """-> (header, body). The header is returned verbatim so a caller can re-join
    the two without disturbing a byte of it."""
    m = DOC_HEADER_RE.match(str(text))
    return (m.group(0), str(text)[m.end():]) if m else ("", str(text))


# ---- fence awareness -------------------------------------------------------
def fenced_ranges(body):
    """Character ranges covered by fenced code blocks, so a literal
    <!--access start--> written INSIDE a ``` example is never treated as a real
    marker. Line-scan ported from webdoc_index.fenced_ranges (same semantics)."""
    ranges = []
    offset = 0
    open_f = None
    for line in str(body).split("\n"):
        start = offset
        end = offset + len(line)
        if open_f is None:
            o = FENCE_OPEN_RE.match(line)
            if o:
                open_f = (o.group(1)[0], len(o.group(1)), start)
        else:
            c = FENCE_CLOSE_RE.match(line)
            if c and c.group(1)[0] == open_f[0] and len(c.group(1)) >= open_f[1]:
                ranges.append((open_f[2], end))
                open_f = None
        offset = end + 1
    if open_f is not None:
        ranges.append((open_f[2], len(str(body))))
    return ranges


def _in_fence(ranges, pos):
    for a, b in ranges:
        if a <= pos < b:
            return True
    return False


# An inline `code span`. Markers mentioned inside one are prose ABOUT the syntax,
# not uses of it - exactly like the fenced case, and exactly how the rest of the
# pipeline already treats code spans (extract_links strips them too).
#
# This also closes a nastier hole than the authoring nuisance it fixes: without
# it, an `<!--access end-->` written inline INSIDE a restricted section would
# close that section early and publish the rest of it. Note that wrapping a real
# marker in backticks to disable it changes the document's access signature, so
# it still needs access-management rights.
INLINE_CODE_RE = re.compile(r'`[^`\n]*`')


def _code_span_ranges(text):
    return [(m.start(), m.end()) for m in INLINE_CODE_RE.finditer(str(text))]


# ---- access specs ----------------------------------------------------------
def normalize_access(raw):
    """Normalise one `access` object into the canonical internal shape.

    Returns None when the document declares no access at all. A present-but-
    malformed block is NOT ignored: it returns a spec restricted to UNPARSABLE,
    a group nobody can hold, so a typo locks a page down instead of opening it.
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        return {"read": UNPARSABLE, "write": UNPARSABLE, "hidden": False,
                "propagate": True, "inherit": True, "label": "", "malformed": True}
    read = raw.get("read", None)
    write = raw.get("write", None)
    # A bare list or string is shorthand for read.
    if isinstance(read, str):
        read = [read]
    if isinstance(write, str):
        write = [write]
    spec = {
        "read": normalize_groups(read) if isinstance(read, list) else None,
        "write": normalize_groups(write) if isinstance(write, list) else None,
        "hidden": bool(raw.get("hidden", False)),
        "propagate": bool(raw.get("propagate", True)),
        "inherit": bool(raw.get("inherit", True)),
        "label": str(raw.get("label") or "")[:80],
        "malformed": False,
    }
    # `"read": []` means "no group at all can read this" - an explicit lockout,
    # not "unrestricted". Unrestricted is expressed by omitting the key, which
    # leaves the value None.
    if spec["read"] is not None and not spec["read"]:
        spec["read"] = UNPARSABLE
    if spec["write"] is not None and not spec["write"]:
        spec["write"] = UNPARSABLE
    # "hidden" with no read list used to be a no-op: visibility() short-circuits
    # on read is None and returns FULL, so the page stayed public. Ticking "hide
    # completely" is an unambiguous intent to restrict, so it now means
    # administrators only unless a read list says otherwise.
    if spec["hidden"] and spec["read"] is None:
        spec["read"] = UNPARSABLE
    if spec["read"] is None and spec["write"] is None and not spec["hidden"]:
        # An access block that restricts nothing still matters for `inherit:false`
        # (an explicit opt-out of a parent's lock); otherwise it is a no-op.
        if spec["inherit"]:
            return None
    return spec


def malformed_access():
    """The spec for a document whose metadata header could not be parsed:
    administrators only. Used where "we do not know what this page declared" must
    not be allowed to mean "it declared nothing"."""
    return {"read": UNPARSABLE, "write": UNPARSABLE, "hidden": False,
            "propagate": False, "inherit": False, "label": "", "malformed": True}


def doc_access_from_meta(meta):
    """The `access` block of a document's <!--meta--> header, normalised."""
    if not isinstance(meta, dict):
        return None
    return normalize_access(meta.get("access"))


def _shorthand(raw_json):
    """Section markers accept either {"read":[...]} or the whole access object."""
    if not isinstance(raw_json, dict):
        return raw_json
    if "access" in raw_json and isinstance(raw_json.get("access"), dict):
        return raw_json["access"]
    return raw_json


def parse_section_regions(body):
    """Find every top-level <!--access start-->...<!--access end--> region.

    -> [{start, end, inner_start, inner_end, spec}] in document order, where
    `start`/`end` bound the whole region (markers included) and `inner_*` bound
    just its content. Nested regions are left inside `inner_*` for a recursive
    pass, so an inner section is only evaluated once its outer section is
    allowed. An unterminated start runs to the end of the document.
    """
    text = str(body)
    ranges = fenced_ranges(text) + _code_span_ranges(text)
    regions = []
    depth = 0
    open_at = None
    open_spec = None
    open_inner = None
    for m in ACCESS_TOKEN_RE.finditer(text):
        if _in_fence(ranges, m.start()):
            continue
        kind = m.group(1).lower()
        if kind == "start":
            if depth == 0:
                open_at = m.start()
                open_inner = m.end()
                try:
                    raw = _shorthand(json.loads(m.group(2))) if m.group(2) else {}
                except ValueError:
                    raw = "malformed"          # not a dict -> the UNPARSABLE spec
                spec = normalize_access(raw)
                # Writing an access marker is an unambiguous intent to restrict, so
                # one that names no read groups is an authoring error and fails
                # CLOSED (administrators only) rather than publishing the section.
                if spec is None or spec.get("read") is None:
                    spec = dict(spec or {"write": None, "hidden": False, "propagate": True,
                                         "inherit": True, "label": "", "malformed": False})
                    spec["read"] = UNPARSABLE
                open_spec = spec
            depth += 1
        else:
            if depth == 0:
                continue                      # stray end marker: ignore
            depth -= 1
            if depth == 0:
                regions.append({"start": open_at, "end": m.end(),
                                "inner_start": open_inner, "inner_end": m.start(),
                                "spec": open_spec})
                open_at = open_spec = open_inner = None
    if depth > 0 and open_at is not None:     # unterminated: fail closed to EOF
        regions.append({"start": open_at, "end": len(text),
                        "inner_start": open_inner, "inner_end": len(text),
                        "spec": open_spec})
    return regions


def section_specs(body):
    """Every section spec in a document, outer and nested, flattened - used to
    report which groups a page mentions and to compare ACLs across an edit."""
    out = []

    def walk(text):
        for r in parse_section_regions(text):
            out.append(r["spec"])
            walk(text[r["inner_start"]:r["inner_end"]])
    walk(str(body))
    return out


# ---- effective ACLs (recursive propagation over `next`) --------------------
def _merge(a, b):
    """Union of two group sets, where None means 'unrestricted'. Unrestricted is
    NOT absorbing here: this only ever merges sets that came from a restriction."""
    if a is None:
        return tuple(b)
    if b is None:
        return tuple(a)
    return tuple(sorted(set(a) | set(b)))


def compute_effective(explicit, edges, doc_ids):
    """Propagate document ACLs down the `next` graph.

    explicit  {doc_id: spec-or-None} as returned by normalize_access
    edges     iterable of (from_id, to_id) pairs - a `next` edge from -> to
    doc_ids   every known document id

    -> {doc_id: {read, write, hidden, explicit, inheritedFrom}} where `read` and
    `write` are tuples of group names or None for unrestricted.

    Monotonic: a document's group sets only ever grow, so a cycle in `next`
    converges instead of looping forever.
    """
    eff = {}
    for did in doc_ids:
        spec = explicit.get(did)
        eff[did] = {
            "read": spec["read"] if spec else None,
            "write": spec["write"] if spec else None,
            "hidden": bool(spec["hidden"]) if spec else False,
            "explicit": bool(spec),
            "inheritedFrom": (),
        }

    out_edges = {}
    for a, b in edges:
        if a in eff and b in eff and a != b:
            out_edges.setdefault(a, set()).add(b)

    # Which explicitly-restricted document(s) a lock travelled from, for the UI's
    # "inherited from ..." explanation.
    origins = {d: ({d} if eff[d]["explicit"] else set()) for d in doc_ids}

    # Seed the worklist with every document that has something to propagate.
    queue = [d for d in doc_ids
             if explicit.get(d) and explicit[d].get("propagate", True)
             and (explicit[d]["read"] is not None or explicit[d]["write"] is not None or explicit[d]["hidden"])]
    # Terminates without an iteration cap: every field only ever grows toward a
    # finite ceiling (the group universe), and a neighbour is re-queued ONLY when
    # something actually changed - so a `next` cycle converges instead of looping.
    while queue:
        cur = queue.pop()
        src = eff[cur]
        for nxt in out_edges.get(cur, ()):
            spec = explicit.get(nxt)
            if spec and not spec.get("inherit", True):
                continue                          # explicit opt-out of inheritance
            declares_read = bool(spec and spec["read"] is not None)
            declares_write = bool(spec and spec["write"] is not None)
            target = eff[nxt]
            changed = False
            # A field is inherited only when the child does not declare its own.
            if not declares_read and src["read"] is not None:
                merged = _merge(target["read"], src["read"])
                if merged != target["read"]:
                    target["read"] = merged
                    changed = True
            if not declares_write and src["write"] is not None:
                merged = _merge(target["write"], src["write"])
                if merged != target["write"]:
                    target["write"] = merged
                    changed = True
            # `hidden` rides along with an inherited read lock; a child that
            # declares its own read governs its own visibility.
            if src["hidden"] and not target["hidden"] and not declares_read:
                target["hidden"] = True
                changed = True
            if changed:
                grew = origins[nxt] | (origins[cur] or {cur})
                if grew != origins[nxt]:
                    origins[nxt] = grew
                target["inheritedFrom"] = tuple(sorted(origins[nxt] - {nxt}))[:8]
                if not spec or spec.get("propagate", True):
                    queue.append(nxt)
    return eff


UNRESTRICTED = {"read": None, "write": None, "hidden": False, "explicit": False, "inheritedFrom": ()}


# ---- decisions -------------------------------------------------------------
FULL = "full"
LOCKED = "locked"      # exists, visible on the map, body withheld
HIDDEN = "hidden"      # must not appear anywhere; treated as non-existent


def visibility(cfg, principal, eff):
    """-> FULL | LOCKED | HIDDEN for one document's effective ACL."""
    if not cfg.enabled:
        return FULL
    eff = eff or UNRESTRICTED
    if principal.admin:
        return FULL
    read = eff.get("read")
    # The sign-in wall comes FIRST. Without this an `anonymousGroups` entry would
    # let a signed-out visitor through a group match on a RESTRICTED page while
    # unrestricted pages still demanded a sign-in - exactly backwards.
    if not principal.authenticated and not cfg.public_read:
        return LOCKED
    if read is None:
        return FULL
    if principal.groups & frozenset(read):
        return FULL
    return HIDDEN if eff.get("hidden") else LOCKED


def can_read(cfg, principal, eff):
    return visibility(cfg, principal, eff) == FULL


def can_write(cfg, principal, eff):
    """Modification rights. Reading is a precondition: you can never edit a page
    you are not allowed to see."""
    if not cfg.enabled:
        return True
    if principal.admin:
        return True
    if not principal.authenticated:
        return False
    if not can_read(cfg, principal, eff):
        return False
    write = (eff or UNRESTRICTED).get("write")
    if write is None:
        # No explicit write ACL: config decides whether every signed-in account
        # may edit (the default, matching the pre-accounts behaviour) or only
        # named groups.
        if cfg.write_groups is None:
            return True
        return bool(principal.groups & frozenset(cfg.write_groups))
    return bool(principal.groups & frozenset(write))


def can_edit_acl(cfg, principal):
    """Whether this principal may CREATE or CHANGE an access block. Separate from
    write rights on purpose: an author who may edit a page must not be able to
    widen that page's own permissions."""
    if not cfg.enabled:
        return True
    if principal.admin:
        return True
    if not principal.authenticated:
        return False
    return bool(principal.groups & frozenset(cfg.acl_editor_groups()))


def can_see_section(cfg, principal, spec):
    """Section-level read decision. A section with no `read` list is visible to
    anyone already allowed to read the document."""
    if not cfg.enabled or principal.admin:
        return True
    read = (spec or {}).get("read")
    if read is None:
        return True
    return bool(principal.groups & frozenset(read))


class Gate:
    """One request's access decisions, bound to a principal and the index's
    effective-ACL map.

    Built once per request and handed to every index query, so a single object is
    the ONLY place a "may they see this document" answer comes from - there is no
    second, subtly different copy of the rule in the search path, the tree path
    and the map path.
    """

    __slots__ = ("cfg", "principal", "acl", "unrestricted", "ready")

    def __init__(self, cfg, principal, acl_map, ready=True):
        self.cfg = cfg
        self.principal = principal
        self.acl = acl_map or {}
        # `ready` is whether the ACL map is AUTHORITATIVE - i.e. the index has
        # finished building and did not fail. An empty map means two completely
        # different things ("nothing is restricted" and "we do not know yet"), and
        # treating the second as the first is a total bypass: every locked and
        # hidden page would be served in full for the length of a cold build.
        self.ready = bool(ready)
        if not cfg.enabled or principal.admin:
            self.unrestricted = True
        elif self.ready and not self.acl and (principal.authenticated or cfg.public_read):
            self.unrestricted = True          # nothing in the library is restricted
        else:
            self.unrestricted = False

    def eff(self, doc_id):
        return self.acl.get(doc_id, UNRESTRICTED)

    def visibility(self, doc_id):
        if self.unrestricted:
            return FULL
        if not self.ready:
            # The ACL map is unknown. Deny rather than guess: an unknown rule is
            # not the same as no rule. Callers turn this into a 503 while the
            # index builds, which is honest and temporary.
            return LOCKED
        return visibility(self.cfg, self.principal, self.eff(doc_id))

    def can_read(self, doc_id):
        return self.visibility(doc_id) == FULL

    def is_hidden(self, doc_id):
        return self.visibility(doc_id) == HIDDEN

    def is_locked(self, doc_id):
        return self.visibility(doc_id) == LOCKED

    def can_write(self, doc_id):
        if not self.cfg.enabled:
            return True
        if not self.ready and not self.principal.admin:
            return False
        return can_write(self.cfg, self.principal, self.eff(doc_id))


# ---- redaction -------------------------------------------------------------
def _redaction_block(spec):
    payload = {
        "read": list((spec or {}).get("read") or []),
        "label": (spec or {}).get("label") or "",
    }
    if payload["read"] == list(UNPARSABLE):
        payload["read"] = []
        payload["malformed"] = True
    return "\n```%s\n%s\n```\n" % (REDACTED_LANG, json.dumps(payload, separators=(",", ":")))


def redact_sections(cfg, principal, body):
    """Remove every section this principal may not see, replacing each with a
    fenced ```wd-restricted``` notice.

    This runs SERVER-SIDE on the raw Markdown before it is written to the
    response, because the browser receives the file verbatim - a client-side
    filter would be decoration, not a control. Returns (text, redacted_count).
    """
    text = str(body)
    if not cfg.enabled or principal.admin:
        return text, 0
    header, text = split_header(text)
    count = [0]

    def walk(chunk):
        regions = parse_section_regions(chunk)
        if not regions:
            return chunk
        out = []
        pos = 0
        for r in regions:
            out.append(chunk[pos:r["start"]])
            if can_see_section(cfg, principal, r["spec"]):
                # Allowed: keep the region EXACTLY as authored - both markers plus
                # the content - and recurse into any nested sections inside it.
                # The markers must survive: they are HTML comments, so they cost
                # this reader nothing (the sanitizer drops them at render time),
                # but the file they are served is what the editor saves back. Ship
                # the content without its markers and an authorised reader's next
                # save silently deletes the section boundary.
                out.append(chunk[r["start"]:r["inner_start"]])
                out.append(walk(chunk[r["inner_start"]:r["inner_end"]]))
                out.append(chunk[r["inner_end"]:r["end"]])
            else:
                count[0] += 1
                out.append(_redaction_block(r["spec"]))
            pos = r["end"]
        out.append(chunk[pos:])
        return "".join(out)

    return header + walk(text), count[0]


def strip_all_sections(body):
    """Every restricted section removed, whoever is asking - the form of a
    document that goes into the full-text index.

    Restricted prose must never reach the search index: FTS snippets would
    otherwise quote withheld text back to anyone able to search. Authorised
    readers lose full-text search INSIDE a restricted section; that is the
    deliberate trade, and it is documented.
    """
    header, text = split_header(str(body))
    regions = parse_section_regions(text)
    if not regions:
        return header + text
    out = [header]
    pos = 0
    for r in regions:
        out.append(text[pos:r["start"]])
        pos = r["end"]
    out.append(text[pos:])
    return "".join(out)


def neutralise_forged_notices(text):
    """Rename any ```wd-restricted fence the AUTHOR wrote, so only the server can
    produce a redaction notice.

    Without this a document could forge the notice - cosmetic on its own, but it
    also lets an author wrap real content in a fake "restricted" block so that
    readers who ARE cleared never see it. Renaming the info string leaves the
    content visible as an ordinary code block, which is the honest outcome.
    """
    return FORGED_NOTICE_RE.sub(r'\1 ' + REDACTED_LANG + '-example', str(text))


# ---- change detection (who may edit an ACL) --------------------------------
def _canonical_spec(spec):
    if not spec:
        return None
    return {
        "read": list(spec.get("read") or []) if spec.get("read") is not None else None,
        "write": list(spec.get("write") or []) if spec.get("write") is not None else None,
        "hidden": bool(spec.get("hidden")),
        "propagate": bool(spec.get("propagate", True)),
        "inherit": bool(spec.get("inherit", True)),
    }


def access_signature(meta, body):
    """A canonical, order-stable fingerprint of every access declaration in one
    document (header block + every section marker, nested included).

    serve.py compares the signature of an incoming PUT with the signature of the
    file on disk; if they differ the writer must additionally hold ACL-edit
    rights. Labels are excluded - re-wording a section's caption is not a
    permission change.
    """
    return json.dumps({
        "doc": _canonical_spec(doc_access_from_meta(meta)),
        "sections": [_canonical_spec(s) for s in section_specs(body)],
    }, sort_keys=True, separators=(",", ":"))


def groups_mentioned(meta, body):
    """Every group name a document names, for the map legend and the editor."""
    names = set()
    spec = doc_access_from_meta(meta)
    for s in ([spec] if spec else []) + section_specs(body):
        for field in ("read", "write"):
            for g in (s.get(field) or ()):
                if g not in UNPARSABLE:
                    names.add(normalize_group(g))
    return tuple(sorted(names))
