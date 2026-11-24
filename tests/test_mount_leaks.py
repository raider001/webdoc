"""The article's mounted components must not accumulate across navigations.

WHY THIS FILE EXISTS. From the Svelte port onward, every requirement group and
test case in a document is a COMPONENT mounted into a placeholder host inside the
article - and `content.textContent = ''` does not destroy a component. Detaching
a node stops nothing: its effects keep running, against DOM nobody can see, for
the rest of the session. reader.js's registerMounted / teardownMounted pair is
what prevents that, and renderDoc fires far more often than a reader navigating -
also on the four-second external-change poll and after every runner save - so a
per-render leak compounds quickly.

tests/test_e2e.py already pins the teardown CONTRACT in isolation (a probe
registered by hand is destroyed when the article is replaced, and one outside the
article is not). What it cannot show is that the real renderer is actually ON
that contract. This does: it churns the reading view between two documents that
both carry a mounted block, and holds the document's size still.

WHAT AN ELEMENT COUNT CAN AND CANNOT SEE - stated plainly, because a test whose
limits are not written down gets trusted for more than it proves:

  * IT SEES a host, a table or a component instance that is added and not
    removed, a placeholder swapped twice, or a mount that fires more than once
    per render. Those are the failure modes of the mount seam itself, and they
    are what a bad port produces first.

  * IT DOES NOT SEE a detached subtree that only the JS heap still holds. Those
    nodes are not in the document and no DOM count reveals them. The guard for
    that is structural - one registry, called on all three paths that replace the
    article - not observational.

So the count is paired here with three things it cannot fake: the number of
mounted hosts inside the article, which must be exactly what the document
declares; the registry itself, wrapped so every mount and every teardown is
counted; and the table's own content after the churn, which proves teardown did
not break re-mounting.

The last two tests come at the same property from the other side. The reason the
shell no longer rebuilds the article when coverage changes is that the badges
repaint in place - so "a status change does NOT cause a render" is part of the
same bargain as "a render does not leak", and it is the half nothing else in the
suite would notice going wrong.

Same conventions as tests/test_e2e.py and tests/test_coverage_ui.py: the real
server on the fixture corpus, web-first assertions, no fixed sleeps.
"""
import re

import pytest
from playwright.sync_api import expect

REQ_DOC = "Guides/Requirements"
TEST_DOC = "Guides/Verification"
REQ_1 = "R_FX_FIX_1"
REQ_2 = "R_FX_FIX_2"
TEST_1 = "T_FX_fix_1"

# How many document swaps the churn performs. Fifty is well past the point where
# any per-render leak stops being deniable: the requirement table alone is over
# twenty elements, so leaking one table per navigation would overshoot the
# tolerance below by two orders of magnitude.
CYCLES = 50

# Element-count tolerance across the whole churn. Not zero: the shell around the
# article is allowed to settle (the drawer reveals the routed document, the live
# region and the header react to a route), and pinning an exact integer would
# make this test fail for reasons that are not leaks. It is still an extremely
# tight bound - a SINGLE leaked requirement row would exceed it.
SLACK = 20


def boot(page):
    page.goto("/", wait_until="domcontentloaded")
    expect(page.locator("body")).to_have_attribute("data-app-ready", "1")
    return page


def spa_navigate(page, doc_id, marker):
    """Route to `doc_id` the way a reader does, WITHOUT reloading the page.

    A full page.goto() would tear the whole app down and rebuild it, which is
    precisely the thing that hides a leak: nothing survives a reload, so nothing
    can accumulate across one. Writing location.hash drives main.js's hashchange
    handler instead, so this exercises the same renderDoc path a click on a link
    takes.

    `marker` is a selector unique to the arriving document, so the wait is on the
    NEW article being on screen rather than on a timer.
    """
    page.evaluate("(h) => { window.location.hash = h; }", f"#/{doc_id}")
    expect(page.locator(marker)).to_have_count(1)


# A selector that only the arriving document can satisfy. The test case also
# carries `.req-group`, hence the :not() on the requirement side.
REQ_MARKER = "#content .doc figure.req-group:not(.test-case)"
TEST_MARKER = "#content .doc figure.test-case"


def element_count(page):
    return page.evaluate("() => document.getElementsByTagName('*').length")


@pytest.mark.e2e
def test_navigating_between_documents_does_not_grow_the_document(page):
    """Fifty document swaps, and the page stays the size it started."""
    # Any error thrown during a render would show up here rather than as a
    # missing element, and a teardown that throws is a leak with a cause.
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    boot(page)

    # WARM UP FIRST, and measure after. The first visit to each document loads
    # its body, resolves its links and expands the drawer folder that contains
    # it; all of that is one-off work whose cost would otherwise be counted as
    # growth. Two full round trips is enough for everything one-off to have
    # happened at least once.
    for _ in range(2):
        spa_navigate(page, REQ_DOC, REQ_MARKER)
        spa_navigate(page, TEST_DOC, TEST_MARKER)
    spa_navigate(page, REQ_DOC, REQ_MARKER)
    baseline = element_count(page)

    for _ in range(CYCLES // 2):
        spa_navigate(page, TEST_DOC, TEST_MARKER)
        spa_navigate(page, REQ_DOC, REQ_MARKER)

    # Ending on the SAME document the baseline was taken on: comparing the
    # requirements page against the verification page would measure the
    # difference between two documents, not growth.
    after = element_count(page)
    assert after <= baseline + SLACK, (
        f"the document grew by {after - baseline} elements over {CYCLES} "
        f"navigations ({baseline} -> {after}). Something mounted inside the "
        f"article is not being torn down by reader.js's teardownMounted, or a "
        f"placeholder is being replaced more than once per render."
    )
    assert not errors, f"the churn raised page errors: {errors}"


@pytest.mark.e2e
def test_each_document_keeps_exactly_its_own_mounted_hosts(page):
    """The article holds one mount host per block, however often it is rebuilt.

    This is the assertion an element count cannot make on its own. Both fixture
    documents declare exactly ONE meta-wrapped block, so exactly one
    `.wd-mounted` host belongs in the article at any moment. A stale host left
    behind by a previous render, or a second host from a double mount, shows up
    here immediately and names the culprit - whereas in a raw element count it
    would only be a number that drifted.
    """
    boot(page)
    hosts = page.locator("#content .doc > .wd-mounted")

    for _ in range(6):
        spa_navigate(page, REQ_DOC, REQ_MARKER)
        expect(hosts).to_have_count(1)
        spa_navigate(page, TEST_DOC, TEST_MARKER)
        expect(hosts).to_have_count(1)


@pytest.mark.e2e
def test_every_mount_is_eventually_destroyed(page):
    """Every component mounted into the article is torn down again.

    THE ASSERTION THE ELEMENT COUNT CANNOT MAKE. A component whose host is merely
    detached leaves no trace in the document, so the counts above would stay
    perfectly flat while its effects ran forever. This watches the registry
    itself instead: `app.registerMounted` is the ONE route a mount inside the
    article takes (requirements/render.js and auth-ui.js both go through it,
    because importing reader.js from either would close a cycle), so wrapping it
    counts every mount and every teardown with nothing able to slip past.

    Patching the service registry is the same seam tests/test_e2e.py uses when it
    imports /js/reader.js directly, and for the same reason: this property is
    invisible from the outside, and the alternative is not testing it.
    """
    boot(page)
    page.evaluate(
        """
        async () => {
          const shell = await import('/js/app-shell.js');
          const inner = shell.app.registerMounted;
          window.__mounts = { registered: 0, destroyed: 0 };
          shell.app.registerMounted = (host, destroy) => {
            window.__mounts.registered++;
            inner(host, () => { window.__mounts.destroyed++; destroy(); });
          };
        }
        """
    )

    for _ in range(CYCLES // 2):
        spa_navigate(page, REQ_DOC, REQ_MARKER)
        spa_navigate(page, TEST_DOC, TEST_MARKER)

    counts = page.evaluate("() => window.__mounts")
    assert counts["registered"] >= CYCLES, (
        f"expected at least one mount per navigation, saw {counts['registered']} "
        f"over {CYCLES} - the requirement/test blocks are not going through "
        f"app.registerMounted at all, so nothing will ever tear them down."
    )
    # Both fixture documents carry exactly one block, so at most the one on
    # screen right now may still be alive.
    live = counts["registered"] - counts["destroyed"]
    assert live <= 1, (
        f"{live} components mounted inside the article were never destroyed "
        f"({counts['registered']} mounted, {counts['destroyed']} torn down). "
        f"Their effects are still running against detached DOM."
    )


@pytest.mark.e2e
def test_the_table_still_renders_correctly_after_heavy_churn(page):
    """Teardown must not cost the next mount anything.

    A destroy that unbinds too much - or a placeholder consumed on the first
    render and missing on the next - would leave a LATER visit with an empty or
    half-built table while the very first one looked perfect. So the same
    assertions tests/test_coverage_ui.py makes on a cold load are made again at
    the end of the churn.
    """
    boot(page)
    for _ in range(CYCLES // 2):
        spa_navigate(page, REQ_DOC, REQ_MARKER)
        spa_navigate(page, TEST_DOC, TEST_MARKER)
    spa_navigate(page, REQ_DOC, REQ_MARKER)

    table = page.locator("#content .doc table.req-tbl")
    expect(table).to_have_count(1)
    expect(table.locator("td.req-idcell .req-badge")).to_have_text([REQ_1, REQ_2])
    expect(table.locator("tbody tr")).to_have_count(2)
    # The description is markdown injected as plain DOM by the fragment action;
    # a torn-down-and-remounted cell that lost it would still have the row.
    expect(table.locator("tbody tr").nth(0)).to_contain_text(
        "The fixture corpus shall exercise the requirement table renderer."
    )
    # And the cross-document link the server index supplies is still there.
    expect(table.locator(f"a.tc-link[href$='?test={TEST_1}']")).to_have_count(1)


# --------------------------------------------------------------------------- #
# the other half of the same argument: a status change must NOT rebuild anything
# --------------------------------------------------------------------------- #
def set_status(page, entries):
    """Replace the coverage-status map the badges colour by.

    Reaches app/js/requirements/store.js directly, as tests/test_e2e.py reaches
    reader.js: it is the module the product itself calls on this path (a coverage
    refresh, a finished test run), and driving it is the only way to observe the
    repaint without recording a real run into the shared fixture corpus.
    """
    page.evaluate(
        """
        async (entries) => {
          const store = await import('/js/requirements/store.js');
          store.setCoverageStatus(entries);
        }
        """,
        entries,
    )


def _status(kind):
    return {"status": kind, "pct": 100, "passed": 1, "failed": 0}


@pytest.mark.e2e
def test_a_status_change_recolours_in_place_instead_of_rerendering(page):
    """Recording a result repaints the badge; it does not rebuild the article.

    THIS BELONGS IN A LEAK FILE, which is not obvious. The vanilla shell's answer
    to "coverage changed" was to call renderDoc() and rebuild the whole document -
    which throws away the scroll position, any open <details>, the find-in-page
    state and every mounted component in the page, and is precisely the churn
    the tests above measure. The badge repainting on the spot is what makes that
    rebuild unnecessary, so it is the same property from the other side.

    Mechanically it also pins the store bridge: statusOf() reads a plain Map that
    Svelte cannot track, and the components only repaint because they read
    covStatus.version in the same expression. Drop that read and everything still
    renders, still passes every other test in the suite, and is silently wrong
    from the first recorded result onwards.
    """
    page.goto(f"/#/{REQ_DOC}", wait_until="domcontentloaded")
    expect(page.locator("body")).to_have_attribute("data-app-ready", "1")

    row = page.locator(f"tr#req-{REQ_1}")
    badge = row.locator(".req-badge")
    # Nothing has been run in the fixture corpus, so boot's own status load
    # already puts every requirement in the untested state.
    expect(badge).to_have_class(re.compile(r"req-badge-st-untested"))

    set_status(page, {REQ_1: _status("pass")})
    expect(badge).to_have_class(re.compile(r"req-badge-st-pass"))
    set_status(page, {REQ_1: _status("fail")})
    expect(badge).to_have_class(re.compile(r"req-badge-st-fail"))

    # The ROW is still the same row - one element, still addressable by the id the
    # deep link uses. A rebuild would have satisfied the class assertions above
    # just as well, which is why this one is here.
    expect(row).to_have_count(1)
    expect(page.locator("#content .doc > .wd-mounted")).to_have_count(1)


@pytest.mark.e2e
def test_a_test_cases_result_pill_repaints_too(page):
    """The same bridge, on the test-case block's rolled-up Result."""
    page.goto(f"/#/{TEST_DOC}", wait_until="domcontentloaded")
    expect(page.locator("body")).to_have_attribute("data-app-ready", "1")

    pill = page.locator("#content .doc figure.test-case .tc-result")
    expect(pill).to_have_text("Untested")

    set_status(page, {TEST_1: _status("pass")})
    expect(pill).to_have_text("Pass")
    expect(pill).to_have_class(re.compile(r"tc-result-pass"))
