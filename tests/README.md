# Web Document Tool — dev test harness

Playwright end-to-end tests **and** the true CommonMark conformance measurement,
driven entirely through Playwright's **Python** binding (`pytest-playwright`).

> This is the project's **only** third-party dependency, and it is **dev-time
> only**. There is **no Node.js, no npm, no `package.json`** anywhere — Playwright
> runs its own bundled Chromium, launched from Python. The tests never touch any
> shared / in-app browser, and they never modify application source: they live in
> `tests/` and use two additional harness files under `app/dev/`.

## What is here

| File | Purpose |
|------|---------|
| `requirements-dev.txt` | pinned dev deps: `pytest`, `pytest-playwright` |
| `pytest.ini` | config; sets `base_url = http://127.0.0.1:8017` |
| `conftest.py` | session fixture that ensures the server is up; pins viewport 1280×900 |
| `test_conformance.py` | measures TRUE CommonMark compliance against the official `spec.json` |
| `test_e2e.py` | stable, renderer-agnostic UI behaviours |

The conformance test loads `app/dev/conformance-full.html`, which renders every
example in `app/dev/commonmark-spec.json` (the official CommonMark 0.31.2
`spec.json`) through `app/js/commonmark.js` and reports the pass rate plus a
per-section breakdown.

## Prerequisites

* **Python 3.9+** on `PATH` (`python --version`).
* The app served at **http://127.0.0.1:8017**. Normally that is `serve.py`
  (it also answers `/site.json` and the `/docs/` JSON listings the app needs).
  From the project root:

  ```powershell
  python serve.py --port 8017
  ```

  If nothing is listening on 8017, `conftest.py` will start a plain
  `python -m http.server 8017 --directory app` for the session as a fallback.
  That fallback is enough for the **conformance** test, but the **e2e** tests
  need `serve.py` (only it emits `/site.json` and `/docs/`).

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
# make sure the app server is up in another terminal first:
#   python serve.py --port 8017

# whole suite
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
* requirement cards + traceability matrix / coverage dashboard (`#reqBtn`, `requirements.js`)
* in-document search highlighting (`#docSearch`)
* all-documents search index / tree filter (`#treeSearch`)
