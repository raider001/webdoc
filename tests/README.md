# Web Document Tool — dev test harness

Playwright end-to-end tests **and** the true CommonMark conformance measurement,
driven entirely through Playwright's **Python** binding (`pytest-playwright`).

> Playwright is **dev-time only** — it runs its own bundled Chromium, launched
> from Python, with no Node involved in the test run itself.
>
> The repository does now carry a `package.json` and a `tsconfig.json`. They are
> **build-time only**: the sole entry is `typescript`, the runtime `dependencies`
> object is empty, and `serve.py` remains Python-standard-library-only and runs
> with no Node installed. See `SVELTE_UPLIFT_PLAN.md`.
>
> The tests never touch any shared / in-app browser, and they never modify
> application source: they live in `tests/` and use four harness files under
> `app/dev/`.

## What is here

| File | Purpose |
|------|---------|
| `requirements-dev.txt` | pinned dev deps: `pytest`, `pytest-playwright` |
| `pytest.ini` | config; sets `base_url = http://127.0.0.1:8017` |
| `conftest.py` | starts `serve.py` on the fixture corpus for the session; pins viewport 1280×900 |
| `fixtures-config.json` | test-only config: mounts `tests/fixtures/` as the single source `Guides` |
| `fixtures/` | the suite's own 8-document corpus, including live XSS payloads |
| `test_conformance.py` | measures TRUE CommonMark compliance against the official `spec.json` |
| `test_e2e.py` | stable, renderer-agnostic UI behaviours |

The conformance test loads `app/dev/conformance-full.html`, which renders every
example in `app/dev/commonmark-spec.json` (the official CommonMark 0.31.2
`spec.json`) through `app/js/commonmark.js` and reports the pass rate plus a
per-section breakdown.

## Prerequisites

* **Python 3.9+** on `PATH` (`python --version`).
* Nothing else. `conftest.py` starts `serve.py` itself, on port 8017, with
  `tests/fixtures-config.json` — you do not need a server running in another
  terminal.

  That config mounts one source, `Guides`, from `tests/fixtures/`, so the suite
  asserts against a corpus it owns rather than against the product's own
  documentation in `docs/`. It also writes its index to `.webdoc-index-test/`, so
  a test run never clobbers the real one.

  If something is already listening on 8017, `conftest.py` checks whether it is
  serving the fixture corpus. If it is, it is reused; if it is not (typically a
  `serve.py` running the product docs), the run **fails immediately with an
  explanation** rather than asserting fixture ids against the wrong corpus.

## Setup (Windows, PowerShell)

Run from the project root `C:\Users\panda\Web_Doc`:

```powershell
# 1. install the dev dependencies (dev-only, isolated to these tests)
python -m pip install -r tests\requirements-dev.txt

# 2. download Playwright's own Chromium (no Node involved)
python -m playwright install chromium
```

## Run

```powershell
# whole suite (conftest starts and stops the server for you)
python -m pytest tests

# see the TRUE CommonMark number and per-section gap printed live:
python -m pytest tests\test_conformance.py -s

# just the end-to-end UI tests
python -m pytest tests\test_e2e.py

# watch it happen in a visible browser
python -m pytest tests --headed --slowmo 300
```

Optional JUnit report (the conformance figures are recorded as properties):

```powershell
python -m pytest tests --junitxml=tests\report.xml
```

## Notes

* `test_conformance.py` is **non-gating on 100%**. The engine was validated
  against a curated 120-case subset, so the official number is expected to be
  below 100%. The test asserts only that the parser clears an observed baseline
  and **prints the honest pass rate and every failing spec section**.
* Each e2e test uses a fresh browser context, so they are independent and can run
  in any order / in parallel.

## Not covered yet (features still changing)

Intentionally left out until the map and requirements features settle:

* map / graph overlay interactions (`#graphBtn`, `.graph-overlay`, node select-and-stay)
* requirement cards + traceability matrix / coverage dashboard (`requirements.js`)
* in-document search highlighting (`#docSearch`)
* all-documents search index / tree filter (`#treeSearch`)
