"""The committed bundle must match what the sources currently build to.

Committing a build artifact buys a Node-free clone; the price is that the
artifact can go stale, and a stale bundle is worse than no bundle because the
repository then contains a `.svelte` source and a compiled result that disagree.
This is the gate that makes staleness impossible to merge.

SKIPS when Node is unavailable. That is deliberate, not a hedge: the whole point
of committing the bundle is that a contributor - and the clone gate in CI - can
run the suite with no Node installed. This test belongs to the networked CI job.
"""
import hashlib
import os
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE_REL = "app/build/islands.js"

pytestmark = pytest.mark.skipif(
    shutil.which("npm") is None or not os.path.isdir(os.path.join(ROOT, "node_modules")),
    reason="no Node toolchain here; the committed bundle is what this machine uses",
)


def _run(*args):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=300)


def test_rebuild_reproduces_the_committed_bundle():
    """`npm run build` must be byte-identical to what is committed."""
    before = open(os.path.join(ROOT, BUNDLE_REL), "rb").read()

    built = _run(shutil.which("npm"), "run", "build")
    assert built.returncode == 0, "npm run build failed:" + built.stdout + built.stderr

    after = open(os.path.join(ROOT, BUNDLE_REL), "rb").read()
    if before != after:
        # Restore, so a failing test does not leave the tree dirty.
        open(os.path.join(ROOT, BUNDLE_REL), "wb").write(before)
        pytest.fail(
            "The committed bundle is STALE: rebuilding from app/svelte/ produced "
            "different bytes. Run `npm run build` and commit app/build/islands.js "
            "in the same commit as the source change that caused it."
        )


def test_the_build_is_reproducible():
    """Two builds of the same commit must produce identical bytes.

    This replaced a git-freshness gate that became meaningless when the compiled
    output stopped being committed - `git diff` cannot police a gitignored path.
    Reproducibility is the property that actually matters now: a release tarball
    is only trustworthy if the tree it contains is the tree the commit describes,
    and CI rebuilds twice and compares for exactly this reason.
    """
    first = _fingerprint()
    built = _run(shutil.which("npm"), "run", "build")
    assert built.returncode == 0, "npm run build failed:\n" + built.stdout + built.stderr
    assert _fingerprint() == first, (
        "Rebuilding produced different output from the same sources. A release "
        "artifact built from this commit would not be reproducible."
    )


def _fingerprint():
    """sha256 of every emitted file, keyed by path."""
    out = {}
    for base, _dirs, files in os.walk(os.path.join(ROOT, "app", "js")):
        for name in sorted(files):
            if not name.endswith(".js"):
                continue
            path = os.path.join(base, name)
            rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
            with open(path, "rb") as fh:
                out[rel] = hashlib.sha256(fh.read()).hexdigest()
    with open(os.path.join(ROOT, BUNDLE_REL), "rb") as fh:
        out[BUNDLE_REL] = hashlib.sha256(fh.read()).hexdigest()
    return out


def test_runtime_dependencies_stay_empty():
    """sys_10 in machine-checkable form.

    Svelte is compiled IN, so nothing resolves it at run time. The day this
    object is non-empty, the app has acquired a genuine runtime dependency and
    the claim in docs/requirements/system.md stops being true.
    """
    import json
    with open(os.path.join(ROOT, "package.json"), encoding="utf-8") as fh:
        pkg = json.load(fh)
    assert pkg.get("dependencies") == {}, (
        f"package.json has runtime dependencies: {pkg.get('dependencies')}. "
        f"Everything third-party must be a devDependency, compiled in or not shipped."
    )
