"""The committed bundle must import the app's own modules, never bundle them.

This is the single property the whole "strangler fig" strategy rests on. Every
import of an existing module has to survive compilation as a bare ESM specifier
so the BROWSER resolves it natively, against the same file main.js already
loaded. One module instance, one copy of its state.

If a specifier were ever bundled instead, the app would quietly run two copies of
that module - two `app` service registries, two `state` objects - and the bugs
would present as Svelte bugs rather than as a build-config mistake. vite.config.js
enforces it at build time; this asserts it on the artifact that is actually
committed, which is the thing that ships.

Needs no Node: it reads the committed file. That matters, because this runs in
the clone gate on a machine with no Node installed.
"""
import os
import re

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE = os.path.join(ROOT, "app", "build", "islands.js")
APP = os.path.join(ROOT, "app")

# `from "x"` / `from'x'`, and bare side-effect `import "x"`.
SPECIFIER_RE = re.compile(r"""(?:\bfrom|^\s*import)\s*(['"])([^'"]+)\1""", re.M)


def _bundle():
    if not os.path.isfile(BUNDLE):
        pytest.fail(
            "app/build/islands.js is missing. It is a COMMITTED build artifact - "
            "run `npm run build` and commit the result. See SVELTE_UPLIFT_PLAN.md."
        )
    with open(BUNDLE, encoding="utf-8") as fh:
        return fh.read()


def test_bundle_exists_and_is_not_empty():
    assert len(_bundle()) > 0


def test_every_import_is_a_root_absolute_app_module():
    """No bare specifiers, no relative paths, no URLs - only /js/... paths."""
    specs = {m.group(2) for m in SPECIFIER_RE.finditer(_bundle())}
    bad = sorted(s for s in specs if not s.startswith("/js/"))
    assert not bad, (
        f"The bundle carries non-app import specifiers: {bad}. A bare specifier "
        f"(e.g. 'svelte') cannot be resolved by a browser, and a relative path "
        f"means an app module was bundled rather than externalised."
    )


def test_every_external_import_resolves_to_a_real_served_file():
    specs = {m.group(2) for m in SPECIFIER_RE.finditer(_bundle())}
    missing = []
    for spec in sorted(specs):
        # The server maps a root-absolute URL onto APP_DIR.
        fs = os.path.join(APP, spec.lstrip("/").replace("/", os.sep))
        if not os.path.isfile(fs):
            missing.append(spec)
    assert not missing, (
        f"The bundle imports {missing}, which the server cannot serve from app/. "
        f"The browser would fail to resolve them at run time."
    )


def test_app_modules_are_not_inlined():
    """A module that is externalised must not ALSO appear inline in the bundle.

    The sentinel is icons.js's SVG PATH DATA, not an identifier. An earlier
    version of this test asserted the name `lockIcon` was absent, which was wrong
    the moment a component legitimately imported it: the identifier then appears
    in the external import statement itself. Path data is the honest marker,
    because it only exists inside the function BODIES - so it can appear in the
    bundle only if those bodies were copied in, which is precisely the failure
    being guarded against.
    """
    src = _bundle()
    assert "/js/icons.js" in src, "expected the icons module to be imported externally"

    with open(os.path.join(APP, "js", "icons.js"), encoding="utf-8") as fh:
        icons = fh.read()
    paths = re.findall(r'\sd="([^"]{20,})"', icons)
    assert len(paths) >= 5, "could not read enough path data out of icons.js to use as a marker"

    leaked = [p for p in paths if p in src]
    assert not leaked, (
        f"app/js/icons.js appears to have been INLINED into the bundle rather than "
        f"left external: {len(leaked)} of its SVG paths are present in the built "
        f"output. Module state is now forked; check the keepNative plugin in "
        f"vite.config.js."
    )


def test_bundle_has_no_dynamic_code_execution():
    src = _bundle()
    for forbidden in ("eval(", "new Function("):
        assert forbidden not in src, (
            f"The bundle contains {forbidden!r}. The server sends a strict CSP with "
            f"no 'unsafe-eval', so this would fail at run time - and it is exactly "
            f"what the policy exists to prevent."
        )


def test_bundle_ships_no_sourcemap():
    """route() serves everything under APP_DIR BEFORE any ACL check, so a .map
    beside the bundle would be readable by a signed-out visitor on an
    accounts-enabled server."""
    assert "sourceMappingURL" not in _bundle()
    assert not os.path.isfile(BUNDLE + ".map")


def test_build_dir_holds_exactly_one_file():
    entries = sorted(os.listdir(os.path.dirname(BUNDLE)))
    assert entries == ["islands.js"], (
        f"app/build/ should contain exactly one committed artifact, found {entries}."
    )
