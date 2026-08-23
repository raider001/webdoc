"""End-to-end tests of the COVERAGE / REQUIREMENTS / RUNNER surface.

Written BEFORE that surface is ported to Svelte, deliberately: grepping tests/
for `cov-`, `req-badge`, `req-tbl`, `runner` or `covBtn` used to return nothing,
so the whole traceability feature - the in-document requirement and test-case
tables, the full-screen Test Coverage overlay with its legend / report panel /
export, and the test runner - had never been exercised by a single test. A
rewrite with no net under it is a rewrite nobody can review.

So every assertion here is chosen to survive the port. They pin

  * what a READER sees   (rows, ids, descriptions, step text, button labels), and
  * the DOM CONTRACT     (the class names the CSS styles and the ids the routes
                          and this suite address: .req-tbl, .req-badge, .tc-run,
                          #covOverlay, .cov-legend-item, .cov-report,
                          #runnerOverlay, tr#req-<ID>),

and nothing about HOW any of it is built. Where the honest assertion is out of
reach - the coverage map is a single <canvas> with no per-node DOM - the comment
says so and the test drives the automation hook graph.js already exposes for
exactly that reason.

Same conventions as tests/test_e2e.py: the `boot(page)` / `open_doc(page, id)`
helpers, a fresh context per test, and web-first `expect(...)` assertions with no
fixed sleeps.

THE FIXTURE CORPUS (tests/fixtures/, mounted as the single source "Guides" with
component "FX" by tests/fixtures-config.json):

  Guides/Requirements   one requirement group, `fix`  -> R_FX_FIX_1, R_FX_FIX_2
  Guides/Verification   one test case, `fix_1`        -> T_FX_fix_1, verifies R_FX_FIX_1

Note the asymmetric casing: requirement ids are upper-cased when composed, test
ids keep the authored key verbatim. That is the product's behaviour, not a typo
here - see requirements/parse.js, where extractReqGroup upper-cases and
extractTestCase does not.
"""
import re

import pytest
from playwright.sync_api import expect

REQ_DOC = "Guides/Requirements"
TEST_DOC = "Guides/Verification"
REQ_1 = "R_FX_FIX_1"
REQ_2 = "R_FX_FIX_2"
TEST_1 = "T_FX_fix_1"

# The em-dash placeholder requirements/render.js's noneCell() puts in an empty
# trace cell. Spelled out as an escape so a failure diff stays readable.
EMDASH = "—"


# --------------------------------------------------------------------------- #
# helpers  (the first two are tests/test_e2e.py's, unchanged)
# --------------------------------------------------------------------------- #
def boot(page):
    """Load the app root and wait until it reports ready."""
    page.goto("/", wait_until="domcontentloaded")
    expect(page.locator("body")).to_have_attribute("data-app-ready", "1")
    return page


def open_doc(page, doc_id):
    """Cold-load a specific document via its hash route and wait for ready."""
    page.goto(f"/#/{doc_id}", wait_until="domcontentloaded")
    expect(page.locator("body")).to_have_attribute("data-app-ready", "1")
    return page


def open_coverage(page):
    """Press the header's coverage button and wait for the overlay to be up.

    #covBtn is a LAZY button - the first press dynamically imports
    coverage-view.js, which then fetches results before it draws anything - so
    "the overlay is revealed" is the only sound thing to wait on here. The graph
    inside it may still be arriving; wait_for_graph() below is the second half.
    """
    page.click("#covBtn")
    expect(page.locator("#covOverlay")).to_be_visible()
    return page.locator("#covOverlay")


def wait_for_graph(page):
    """Wait until the coverage map has laid its nodes out.

    `window.__graph` is not an implementation detail leaking into the tests: it
    is the automation hook graph.js installs and documents (GraphTestApi) FOR
    this suite, precisely because the map is one <canvas> with no per-node DOM to
    query. Its count() is how we know the layout has run.
    """
    page.wait_for_function("() => !!(window.__graph && window.__graph.count() > 0)")


def click_graph_node(page, node_id):
    """Click a coverage-map node by id, via the canvas hit-test hook.

    center(id) answers in CLIENT pixels, so this is a real mouse click at a real
    screen position - the same event path a reader's click takes, rather than a
    synthesized call into a handler.
    """
    point = page.evaluate(
        "(id) => (window.__graph && window.__graph.center(id)) || null", node_id
    )
    assert point, f"the coverage map has no node for {node_id}"
    page.mouse.click(point["x"], point["y"])


# --------------------------------------------------------------------------- #
# the in-document requirement table
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_requirement_table_renders_in_the_article(page):
    """The requirement group renders as a table INSIDE the article.

    "Inside the article" is load-bearing, and is why every locator below is
    anchored at `#content .doc`: the table replaces a fenced placeholder in the
    rendered document, so it has to be part of the document body - not chrome
    parked beside it. Phase 4's article contract (mounted hosts carry
    .wd-mounted, find-in-page skips them) only means anything if what is mounted
    is genuinely in there.
    """
    open_doc(page, REQ_DOC)
    article = page.locator("#content .doc")

    group = article.locator("figure.req-group")
    expect(group).to_have_count(1)
    # The caption names the group the author declared in the block metadata.
    expect(group.locator("figcaption.req-cap")).to_contain_text("fix")

    table = group.locator("table.req-tbl")
    expect(table).to_have_count(1)
    expect(table.locator("thead th")).to_have_text(
        ["Requirement", "Description", "Trace To", "Trace From", "Verified By"]
    )
    rows = table.locator("tbody tr")
    expect(rows).to_have_count(2)

    # The composed ids: R_{component}_{group}_{no}, upper-cased.
    expect(table.locator("td.req-idcell .req-badge")).to_have_text([REQ_1, REQ_2])

    # Descriptions come straight from the authored table, rendered as inline
    # markdown - so assert the text a reader reads, not the markup around it.
    expect(rows.nth(0)).to_contain_text(
        "The fixture corpus shall exercise the requirement table renderer."
    )
    expect(rows.nth(1)).to_contain_text(
        "The fixture corpus shall exercise inverse traceability."
    )

    # Every row that composed a real id is addressable, which is what makes the
    # ?req= deep link at the bottom of this file possible at all.
    expect(article.locator(f"tr#req-{REQ_1}")).to_have_count(1)
    expect(article.locator(f"tr#req-{REQ_2}")).to_have_count(1)


@pytest.mark.e2e
def test_verified_by_column_is_populated_from_the_server_index(page):
    """Verified By is the CALCULATED inverse of a test's `verifies`.

    Nothing in Guides/Requirements mentions T_FX_fix_1 - the link is authored on
    the test case, in a different document, and only the server's coverage index
    knows about it. So a populated Verified By cell here proves the whole
    pipeline end to end: /api/index/coverage -> buildRequirementIndex ->
    prepareDocGroups -> the rendered row. If the port drops the enrichment step,
    the table still renders and only this fails.
    """
    open_doc(page, REQ_DOC)
    rows = page.locator("#content .doc table.req-tbl tbody tr")

    verified_1 = rows.nth(0).locator("td").nth(4)
    link = verified_1.locator("a.tc-link")
    expect(link).to_have_count(1)
    expect(link).to_have_text(TEST_1)
    # It links INTO the verifying test's own document, with that test selected -
    # and the query lives inside the hash, deliberately (see requirements.js).
    expect(link).to_have_attribute("href", f"#/{TEST_DOC}?test={TEST_1}")

    # R_FX_FIX_2 is verified by nothing, so its cell shows the placeholder.
    expect(rows.nth(1).locator("td").nth(4)).to_have_text(EMDASH)


@pytest.mark.e2e
def test_trace_columns_render_the_empty_placeholder(page):
    """Trace To / Trace From render an explicit "nothing here" marker.

    HONEST LIMIT: neither fixture requirement traces to the other, and the eight
    existing fixture documents must not be edited (tests/test_e2e.py asserts
    exact document counts over them), so a POPULATED Trace From cannot be
    exercised without changing the corpus. What is asserted instead is the
    contract that holds for every empty trace cell in the product - an em-dash
    placeholder rather than a blank cell - which is the half a port is actually
    likely to lose.
    """
    open_doc(page, REQ_DOC)
    rows = page.locator("#content .doc table.req-tbl tbody tr")
    for i in (0, 1):
        # Trace To is column index 2, Trace From index 3.
        expect(rows.nth(i).locator("td").nth(2).locator("span.req-none")).to_have_text(EMDASH)
        expect(rows.nth(i).locator("td").nth(3).locator("span.req-none")).to_have_text(EMDASH)


# --------------------------------------------------------------------------- #
# the in-document test case
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_test_case_block_renders_its_steps_and_run_button(page):
    """A test case renders as caption + Verifies line + numbered step table."""
    open_doc(page, TEST_DOC)
    article = page.locator("#content .doc")

    case = article.locator("figure.req-group.test-case")
    expect(case).to_have_count(1)
    expect(case).to_have_attribute("id", f"test-{TEST_1}")

    cap = case.locator("figcaption.tc-cap")
    expect(cap).to_contain_text("Test case")
    expect(cap.locator(".tc-id")).to_have_text(TEST_1)
    # No results are recorded anywhere in the fixture corpus, so the badge shows
    # the untested state. Asserting the WORD rather than the modifier class keeps
    # this about what the reader is actually told.
    expect(cap.locator(".tc-result")).to_have_text("Untested")

    # Tracing is authored ON the test; the link points back at the requirement.
    verifies = case.locator("p.tc-verifies")
    expect(verifies).to_contain_text("Verifies")
    expect(verifies.locator("a.req-link")).to_have_text(REQ_1)
    expect(verifies.locator("a.req-link")).to_have_attribute(
        "href", f"#/{REQ_DOC}?req={REQ_1}"
    )

    steps = case.locator("table.test-steps-tbl")
    expect(steps.locator("thead th")).to_have_text(["#", "Action", "Expected response"])
    rows = steps.locator("tbody tr")
    expect(rows).to_have_count(1)
    expect(rows.nth(0).locator("td.tc-stepno")).to_have_text("1")
    expect(rows.nth(0)).to_contain_text("Open the requirements fixture.")
    expect(rows.nth(0)).to_contain_text("The requirement table renders with two rows.")

    run = case.locator("button.tc-run")
    expect(run).to_have_count(1)
    expect(run).to_have_attribute("title", "Run this test case")
    expect(run).to_contain_text("Run")


# --------------------------------------------------------------------------- #
# the coverage overlay
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_coverage_overlay_opens_from_the_button_and_closes_again(page):
    """#covOverlay exists from first paint, hidden, and #covBtn toggles it.

    The "exists while hidden" half is not incidental: overlays.js creates both
    hosts eagerly at boot precisely so the modules that FILL them can stay lazy,
    and several call sites read `!el('covOverlay').hidden` with no null guard.
    """
    boot(page)
    overlay = page.locator("#covOverlay")
    expect(overlay).to_have_count(1)
    expect(overlay).to_be_hidden()
    expect(page.locator("#covBtn")).to_have_attribute("aria-pressed", "false")

    open_coverage(page)
    expect(page.locator("#covBtn")).to_have_attribute("aria-pressed", "true")

    # A second press closes it again.
    page.click("#covBtn")
    expect(overlay).to_be_hidden()
    expect(page.locator("#covBtn")).to_have_attribute("aria-pressed", "false")


@pytest.mark.e2e
def test_coverage_overlay_closes_on_escape(page):
    boot(page)
    open_coverage(page)
    page.keyboard.press("Escape")
    expect(page.locator("#covOverlay")).to_be_hidden()
    expect(page.locator("#covBtn")).to_have_attribute("aria-pressed", "false")


@pytest.mark.e2e
def test_status_legend_renders_four_entries_and_toggles(page):
    """The legend is a filter, and each entry is a toggle button.

    aria-pressed is asserted rather than the `is-off` class: the class is how the
    entry is PAINTED, aria-pressed is what it MEANS, and a screen-reader user has
    nothing else to go on.
    """
    boot(page)
    overlay = open_coverage(page)

    items = overlay.locator(".cov-legend .cov-legend-item")
    expect(items).to_have_count(4)
    expect(items).to_have_text(["Passing", "Failing", "Partial", "Untested"])
    # Everything is shown to begin with.
    for i in range(4):
        expect(items.nth(i)).to_have_attribute("aria-pressed", "true")

    passing = items.nth(0)
    passing.click()
    expect(passing).to_have_attribute("aria-pressed", "false")
    # ...and only that one.
    expect(items.nth(1)).to_have_attribute("aria-pressed", "true")

    passing.click()
    expect(passing).to_have_attribute("aria-pressed", "true")


@pytest.mark.e2e
def test_export_report_button_is_present_and_labelled(page):
    """The export affordance is present and says what it will do.

    Deliberately NOT clicked: pressing it downloads a file, and a test whose side
    effect is a file on disk fails differently on someone else's machine. What a
    port can plausibly break is the button going missing or losing its
    explanation, and that is what this pins.
    """
    boot(page)
    overlay = open_coverage(page)
    btn = overlay.locator("button.cov-export-btn")
    expect(btn).to_be_visible()
    expect(btn).to_contain_text("Export report")
    expect(btn).to_have_attribute(
        "title", "Download a self-contained test report (HTML) you can share anywhere"
    )


@pytest.mark.e2e
def test_report_panel_opens_for_a_requirement_and_shows_its_verifying_test(page):
    """Selecting a requirement on the map opens its report panel."""
    boot(page)
    overlay = open_coverage(page)
    wait_for_graph(page)

    panel = overlay.locator("aside.cov-report")
    expect(panel).to_be_hidden()

    click_graph_node(page, REQ_1)
    expect(panel).to_be_visible()
    expect(panel.locator(".cov-report-head h2")).to_have_text(REQ_1)
    expect(panel).to_contain_text(
        "The fixture corpus shall exercise the requirement table renderer."
    )

    # The verifying test case is listed by id, and the count in the section
    # heading agrees with the list under it.
    expect(panel.locator(".cov-vtests h3")).to_contain_text("(1)")
    entry = panel.locator(".cov-vtest-list .cov-vtest")
    expect(entry).to_have_count(1)
    expect(entry.locator(".cov-vtest-id")).to_have_text(TEST_1)

    # A way back out of the panel that leaves the overlay itself open.
    panel.locator("button.cov-report-close").click()
    expect(panel).to_be_hidden()
    expect(overlay).to_be_visible()


# --------------------------------------------------------------------------- #
# the runner
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_runner_opens_from_a_test_cases_run_button_and_closes(page):
    """Run on a test-case block opens the full-screen runner for THAT test.

    Nothing is saved: a save writes a manual-results sidecar into the fixture
    corpus, which the whole suite shares. Opening and closing is what this net
    has to protect anyway - the port is what puts the overlay on screen, not what
    records a run.
    """
    open_doc(page, TEST_DOC)
    page.click("#content .doc figure.test-case button.tc-run")

    runner = page.locator("#runnerOverlay")
    expect(runner).to_be_visible()
    # The whole page is in run mode - the body class is what stops the document
    # scrolling behind the overlay.
    expect(page.locator("body")).to_have_class(re.compile(r"\bis-running\b"))

    card = runner.locator(f"section.run-test[data-test-id='{TEST_1}']")
    expect(card).to_have_count(1)
    expect(card).to_contain_text("fix_1")
    expect(card.locator("p.run-verifies")).to_contain_text(REQ_1)

    # The step grid carries the definition columns plus the two the tester fills in.
    grid = card.locator("table.run-grid")
    expect(grid.locator("thead th")).to_have_text(
        ["#", "Action", "Expected response", "Actual response", "Result"]
    )
    step_rows = grid.locator("tbody tr")
    expect(step_rows).to_have_count(1)
    expect(step_rows.nth(0)).to_contain_text("Open the requirements fixture.")
    expect(step_rows.nth(0)).to_contain_text("The requirement table renders with two rows.")
    # Pass / Fail per step, neither recorded yet.
    expect(step_rows.nth(0).locator(".run-pf button.run-pf-btn")).to_have_count(2)

    runner.locator(".runner-bar button", has_text="Close").click()
    expect(page.locator("#runnerOverlay")).to_have_count(0)
    expect(page.locator("body")).not_to_have_class(re.compile(r"\bis-running\b"))


# --------------------------------------------------------------------------- #
# deep links   (#/<docId>?req=<ID> - the query lives INSIDE the hash)
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_deep_link_reveals_and_flashes_a_requirement_row(page):
    """?req=<ID> scrolls that row into view and flashes it.

    The flash is transient (~1.6s), so it is caught with a polling predicate
    started the moment the route resolves rather than with a fixed sleep - and
    then its REMOVAL is asserted too, because a highlight that never clears is
    its own bug.
    """
    page.goto(f"/#/{REQ_DOC}?req={REQ_1}", wait_until="domcontentloaded")
    expect(page.locator("body")).to_have_attribute("data-app-ready", "1")

    row = page.locator(f"tr#req-{REQ_1}")
    page.wait_for_function(
        "(id) => { const e = document.getElementById(id); "
        "return !!e && e.classList.contains('req-flash'); }",
        arg=f"req-{REQ_1}",
    )
    expect(row).to_be_in_viewport()
    # The route survives the reveal: the query stays inside the hash, so a later
    # navigation cannot carry a stale ?req= onto a document that has no such row.
    expect(page).to_have_url(re.compile(re.escape(f"#/{REQ_DOC}?req={REQ_1}") + r"$"))
    # And the flash is a flash.
    expect(row).not_to_have_class(re.compile(r"req-flash"))


@pytest.mark.e2e
def test_deep_link_reveals_and_flashes_a_test_case(page):
    """?test=<ID> does the same for a test-case block."""
    page.goto(f"/#/{TEST_DOC}?test={TEST_1}", wait_until="domcontentloaded")
    expect(page.locator("body")).to_have_attribute("data-app-ready", "1")

    case = page.locator(f"figure#test-{TEST_1}")
    page.wait_for_function(
        "(id) => { const e = document.getElementById(id); "
        "return !!e && e.classList.contains('req-flash'); }",
        arg=f"test-{TEST_1}",
    )
    expect(case).to_be_in_viewport()
    expect(case).not_to_have_class(re.compile(r"req-flash"))


@pytest.mark.e2e
def test_verified_by_link_navigates_to_the_verifying_test(page):
    """Following a Verified By link lands on that test, in its own document.

    This is the two halves joined up: the href the table renders is a route the
    router understands. Clicking it - rather than typing the URL - is what proves
    the renderer and the router still agree after the port.
    """
    open_doc(page, REQ_DOC)
    page.click(f"#content .doc table.req-tbl a.tc-link[href$='?test={TEST_1}']")

    expect(page.locator("#content .doc h1")).to_contain_text("Verification")
    case = page.locator(f"figure#test-{TEST_1}")
    expect(case).to_have_count(1)
    expect(case).to_be_in_viewport()
