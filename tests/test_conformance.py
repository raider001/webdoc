"""TRUE CommonMark compliance measurement.

Drives Playwright's own Chromium to /dev/conformance-full.html, which renders
EVERY example in the official CommonMark 0.31.2 spec.json through the app's
hand-written parser (app/js/commonmark.js) and reports pass/total plus a
per-section breakdown.

This test is deliberately NON-GATING on 100%: the engine was validated against a
curated 120-case subset, not the full official suite, so the real number is
expected to be below 100%. We assert only that the parser clears an observed
baseline, and we PRINT the honest figure and every failing section so the true
remaining gap is visible in the test output.
"""
import json

import pytest

# Observed floor. The measured rate must not silently regress below this.
# (Set from an actual run of the harness; see the printed report.)
BASELINE_PASS_RATE = 0.55


@pytest.mark.conformance
def test_commonmark_full_spec(page, base_url, record_property):
    page.goto("/dev/conformance-full.html", wait_until="domcontentloaded")

    # The harness sets data-done="1" when it has run every example (or errored).
    page.wait_for_selector("body[data-done='1']", timeout=120_000)

    body = page.locator("body")
    err = body.get_attribute("data-error")
    assert err is None, f"conformance harness reported an error: {err}"

    pass_count = int(body.get_attribute("data-pass"))
    total = int(body.get_attribute("data-total"))
    sections = json.loads(body.get_attribute("data-sections"))

    assert total > 600, (
        f"expected the full official spec (>600 examples), only saw {total} — "
        "is /dev/commonmark-spec.json the real spec.json?"
    )

    rate = pass_count / total

    # Record for machine-readable JUnit output.
    record_property("commonmark_pass", pass_count)
    record_property("commonmark_total", total)
    record_property("commonmark_pass_rate", round(rate, 4))

    # Honest, human-readable report (shown with `pytest -s` or on failure).
    failing = {name: s for name, s in sections.items() if s["fail"] > 0}
    lines = [
        "",
        "=" * 66,
        "  TRUE CommonMark 0.31.2 compliance (official spec.json)",
        "=" * 66,
        f"  PASS {pass_count} / {total}   ({100 * rate:.2f}%)",
        f"  Sections with failures: {len(failing)} / {len(sections)}",
        "-" * 66,
    ]
    for name, s in sorted(failing.items(), key=lambda kv: kv[1]["fail"], reverse=True):
        lines.append(f"  {s['fail']:>4} fail / {s['total']:>3} total   {name}")
    if not failing:
        lines.append("  No failing sections — full compliance.")
    lines.append("=" * 66)
    print("\n".join(lines))

    # Non-gating sanity: the parser renders SOMETHING and clears the floor.
    assert pass_count > 0, "parser produced zero passes — something is broken"
    assert rate >= BASELINE_PASS_RATE, (
        f"CommonMark pass rate {100 * rate:.2f}% fell below the observed baseline "
        f"of {100 * BASELINE_PASS_RATE:.2f}% — a real regression in commonmark.js. "
        "See the per-section report above."
    )
