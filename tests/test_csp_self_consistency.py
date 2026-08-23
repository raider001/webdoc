"""The policy the server sends must actually permit everything the app loads.

serve.py computes `script-src 'self' <sha256 of each inline script in
app/index.html>` with no 'unsafe-inline'. That is a strong policy, and its
failure mode is silent: a blocked script does not error the page, it simply never
runs, so the symptom is a feature that quietly does nothing.

That is not hypothetical. Every inline script under app/dev/ WAS blocked under
this policy - `_inline_script_hashes` only ever reads app/index.html - so the
conformance harnesses did nothing when served by serve.py, and looked fine only
because the old test fallback served no policy at all. These tests encode that
lesson so it cannot come back.

Needs no Node: the clone gate runs it.
"""
import os
import re
import urllib.request

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")

INLINE_SCRIPT_RE = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S | re.I)


def _html_files():
    for base, _dirs, files in os.walk(APP):
        for name in files:
            if name.endswith(".html"):
                yield os.path.join(base, name)


def _fetch_headers(base_url, path):
    req = urllib.request.Request(base_url.rstrip("/") + path)
    with urllib.request.urlopen(req, timeout=5) as resp:
        return dict(resp.headers), resp.read().decode("utf-8", "replace")


def test_only_index_html_carries_an_inline_script():
    """Any OTHER page with an inline script is a page whose script never runs."""
    offenders = []
    for path in _html_files():
        rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
        with open(path, encoding="utf-8") as fh:
            body = fh.read()
        if INLINE_SCRIPT_RE.search(body) and rel != "app/index.html":
            offenders.append(rel)
    assert not offenders, (
        f"These pages carry inline <script> blocks that the CSP will block, "
        f"because serve.py only hashes app/index.html: {offenders}. Move the "
        f"script to a sibling .js file and load it with <script src=...>."
    )


def test_csp_is_sent_and_forbids_unsafe_inline(base_url):
    headers, _ = _fetch_headers(base_url, "/")
    csp = headers.get("Content-Security-Policy")
    assert csp, "no Content-Security-Policy header was sent"
    assert "'unsafe-inline'" not in csp.split("style-src")[0], (
        "script-src permits 'unsafe-inline'; a sanitizer escape would become "
        "script execution."
    )
    assert "'unsafe-eval'" not in csp


def test_index_inline_script_is_hashed_in_the_policy(base_url):
    """The one inline script the app keeps must be covered by a hash."""
    import base64
    import hashlib

    headers, body = _fetch_headers(base_url, "/")
    csp = headers["Content-Security-Policy"]
    inline = INLINE_SCRIPT_RE.findall(body)
    assert inline, "app/index.html no longer has an inline script; update this test"
    for block in inline:
        digest = hashlib.sha256(block.encode("utf-8")).digest()
        expected = "'sha256-%s'" % base64.b64encode(digest).decode("ascii")
        assert expected in csp, (
            "An inline script in index.html is NOT covered by the policy. The "
            "theme would resolve after first paint, flashing the wrong theme."
        )


def test_the_island_bundle_is_served_as_javascript(base_url):
    """The bundle is loaded as a module by app/js/islands.js; a wrong
    content-type makes the browser refuse it, and Windows' registry has a
    long-standing habit of reporting .js as text/plain."""
    headers, body = _fetch_headers(base_url, "/build/islands.js")
    ctype = headers.get("Content-Type", "")
    assert "javascript" in ctype, f"bundle served as {ctype!r}, not JavaScript"
    assert len(body) > 0
