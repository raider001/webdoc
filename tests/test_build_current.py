"""The committed bundle must match what the sources currently build to.

Committing a build artifact buys a Node-free clone; the price is that the
artifact can go stale, and a stale bundle is worse than no bundle because the
repository then contains a `.svelte` source and a compiled result that disagree.
This is the gate that makes staleness impossible to merge.

SKIPS when Node is unavailable. That is deliberate, not a hedge: the whole point
of committing the bundle is that a contributor - and the clone gate in CI - can
run the suite with no Node installed. This test belongs to the networked CI job.
"""
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
    assert built.returncode == 0, f"npm run build failed:\n{built.stdout}\n{built.stderr}"

    after = open(os.path.join(ROOT, BUNDLE_REL), "rb").read()
    if before != after:
        # Restore, so a failing test does not leave the tree dirty.
        open(os.path.join(ROOT, BUNDLE_REL), "wb").write(before)
        pytest.fail(
            "The committed bundle is STALE: rebuilding from app/svelte/ produced "
            "different bytes. Run `npm run build` and commit app/build/islands.js "
            "in the same commit as the source change that caused it."
        )


def test_the_bundle_is_actually_tracked_by_git():
    """The freshness gate below is VACUOUS unless the bundle is tracked.

    `git diff --exit-code -- <untracked path>` trivially returns 0, so if
    app/build/ is untracked the freshness test passes no matter how stale the
    artifact is. That is exactly the state this branch was in when the gate was
    written, which made the gate look green while checking nothing.

    Committing the bundle is the whole reason a Node-free clone works
    (SVELTE_UPLIFT_PLAN.md, sys_9), so "not tracked yet" is a real, temporary
    condition during the migration - but it must be LOUD rather than silent.
    """
    if shutil.which("git") is None:
        pytest.skip("git not available")
    ls = _run(shutil.which("git"), "ls-files", "--error-unmatch", BUNDLE_REL)
    assert ls.returncode == 0, (
        f"{BUNDLE_REL} is NOT tracked by git, so the freshness gate below cannot "
        f"do its job - `git diff` returns 0 for an untracked path regardless of "
        f"content. Commit the bundle: it is what makes a clone without Node work."
    )


def test_git_reports_the_bundle_clean_after_a_rebuild():
    """The freshness gate as CI runs it.

    Also proves .gitattributes is doing its job: core.autocrlf is true on at
    least one machine here, and without `-text eol=lf` on the bundle a
    byte-identical rebuild would still show as modified.

    Guarded on the bundle being tracked - see the test above for why an
    unguarded version would be vacuous rather than merely wrong.
    """
    if shutil.which("git") is None:
        pytest.skip("git not available")
    if _run(shutil.which("git"), "ls-files", "--error-unmatch", BUNDLE_REL).returncode != 0:
        pytest.skip("bundle not tracked yet; see test_the_bundle_is_actually_tracked_by_git")
    built = _run(shutil.which("npm"), "run", "build")
    assert built.returncode == 0, built.stderr

    diff = _run(shutil.which("git"), "diff", "--exit-code", "--", BUNDLE_REL)
    assert diff.returncode == 0, (
        "git reports app/build/islands.js as modified after a clean rebuild.\n"
        "Either the bundle is stale and needs committing, or line-ending "
        "normalisation is fighting the build - check .gitattributes.\n"
        f"{diff.stdout}"
    )


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
