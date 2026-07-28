"""Shared pytest fixtures for the Web Document Tool test suite.

These tests drive Playwright's OWN Chromium (via the Python binding only). They
never touch any in-app / shared browser, and they never edit application source.

The suite assumes the app is served at http://127.0.0.1:8017. In normal use that
is `serve.py` (which also answers /site.json and the /docs/ JSON listings the app
needs). If nothing is listening there, this fixture starts a plain
`python -m http.server` on that port as a fallback for the session and tears it
down afterwards. NOTE: the plain http.server can serve the static conformance
harnesses, but it does NOT emit /site.json or /docs/ listings, so the end-to-end
tests need serve.py to be the thing running. The fixture prefers whatever is
already up.
"""
import subprocess
import sys
import time
import urllib.request

import pytest

APP_DIR = "C:/Users/panda/Web_Doc/app"
PORT = 8017
HOST = "127.0.0.1"


def _server_responding(url, timeout=1.5):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return 200 <= resp.status < 500
    except Exception:
        return False


@pytest.fixture(scope="session", autouse=True)
def static_server(base_url):
    """Ensure something is serving the app at base_url for the whole session."""
    root = base_url.rstrip("/") + "/"
    if _server_responding(root):
        # Already up (normally serve.py). Leave it exactly as we found it.
        yield base_url
        return

    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT),
         "--bind", HOST, "--directory", APP_DIR],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.time() + 15
        while time.time() < deadline:
            if _server_responding(root):
                break
            time.sleep(0.25)
        else:
            proc.terminate()
            raise RuntimeError(
                f"Could not start a static server on {root}. "
                "Start serve.py manually and retry."
            )
        yield base_url
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    """Pin the viewport for every browser context. base_url (from pytest-base-url)
    is preserved by spreading the original args."""
    return {
        **browser_context_args,
        "viewport": {"width": 1280, "height": 900},
    }
