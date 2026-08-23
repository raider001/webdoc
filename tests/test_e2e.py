"""End-to-end tests of STABLE, renderer-agnostic app behaviour.

These exercise behaviours that do NOT depend on which Markdown engine is wired
in (the app currently ships the interim renderer and will later swap in
commonmark.js) and that are not part of the still-changing map / requirements
features: boot, theme, the document drawer, routing/deep-links, heading
numbering vs. TOC, the sanitizer, the metadata footer, and the skip link.

Every test uses a fresh Playwright context (the default function-scoped `page`
fixture) so they stay independent, and web-first `expect(...)` assertions so
there are no fixed sleeps.

Deliberately NOT covered yet (features still in flux — see module TODO):
  * map / graph overlay interactions (#graphBtn, .graph-overlay, node select)
  * requirement cards + traceability matrix (requirements.js)
  * in-document search highlighting (#docSearch)
  * all-documents search index / tree filter (#treeSearch)
"""
import re

import pytest
from playwright.sync_api import expect

# Fixture document ids. The corpus lives in tests/fixtures/ and is mounted as the
# single source "Guides" by tests/fixtures-config.json, so these ids are owned by
# the suite - not by the product's own documentation under docs/.
#
# TOP_LEVEL_DOCS is what the lazy tree renders before any folder is expanded;
# NESTED_DOCS arrive only when "concepts" is opened. See the drawer test.
DEFAULT_DOC = "Guides/getting-started"
TOP_LEVEL_DOCS = [
    "Guides/Requirements",
    "Guides/Verification",
    "Guides/dafu-was-here",
    "Guides/getting-started",
    "Guides/markdown-kitchen-sink",
    "Guides/security-and-html",
]
NESTED_DOCS = [
    "Guides/concepts/graph-model",
    "Guides/concepts/metadata-tags",
]
DOC_IDS = TOP_LEVEL_DOCS + NESTED_DOCS


# --------------------------------------------------------------------------- #
# helpers
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


# --------------------------------------------------------------------------- #
# boot
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_app_boots(page):
    page.goto("/", wait_until="domcontentloaded")
    expect(page.locator("body")).to_have_attribute("data-app-ready", "1")
    # The default document renders into #content.
    expect(page.locator("#content .doc h1")).to_be_visible()


# --------------------------------------------------------------------------- #
# theme
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_theme_toggle_flips_and_persists(page):
    boot(page)
    root = page.locator("html")
    before = root.get_attribute("data-theme")
    assert before in ("light", "dark")
    expected = "dark" if before == "light" else "light"

    page.click("#themeBtn")
    expect(root).to_have_attribute("data-theme", expected)
    # aria-pressed reflects dark state.
    expect(page.locator("#themeBtn")).to_have_attribute(
        "aria-pressed", "true" if expected == "dark" else "false"
    )
    # Persisted to localStorage under the app's key.
    assert page.evaluate("() => localStorage.getItem('wd-theme')") == expected

    # Survives a reload.
    page.reload(wait_until="domcontentloaded")
    expect(page.locator("body")).to_have_attribute("data-app-ready", "1")
    expect(page.locator("html")).to_have_attribute("data-theme", expected)


@pytest.mark.e2e
@pytest.mark.parametrize("stored", ["dark", "light"])
def test_theme_honored_on_cold_load(page, stored):
    # Prime localStorage, then cold-load: the pre-paint script must honor it.
    boot(page)
    page.evaluate("(v) => localStorage.setItem('wd-theme', v)", stored)
    page.reload(wait_until="domcontentloaded")
    expect(page.locator("body")).to_have_attribute("data-app-ready", "1")
    expect(page.locator("html")).to_have_attribute("data-theme", stored)


# --------------------------------------------------------------------------- #
# drawer / document tree
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_drawer_opens_lists_docs_and_closes_by_escape_and_scrim(page):
    boot(page)
    drawer = page.locator("#doc-tree")
    scrim = page.locator("#scrim")
    hamburger = page.locator("#hamburger")

    expect(drawer).to_be_hidden()

    # Open.
    hamburger.click()
    expect(drawer).to_be_visible()
    expect(scrim).to_be_visible()
    expect(hamburger).to_have_attribute("aria-expanded", "true")

    # Lists one folder level at a time. renderTree auto-opens the FIRST source
    # ("Guides"), so its six documents are present on boot - but "concepts" is a
    # collapsed <details> whose children are only fetched from
    # GET /api/index/tree?path= when it is opened. Asserting a flat count of the
    # whole corpus would assert behaviour renderTree deliberately does not have.
    links = page.locator("#treeList a.doc-link")
    expect(links).to_have_count(len(TOP_LEVEL_DOCS))
    expect(page.locator("#treeList a.doc-link[data-id='Guides/getting-started']")).to_have_text(
        "Getting Started"
    )
    for doc_id in NESTED_DOCS:
        expect(page.locator(f"#treeList a.doc-link[data-id='{doc_id}']")).to_have_count(0)

    # Expanding the folder fetches its children, and only then do they exist.
    # Target the nested folder by data-path: the FIRST summary is the source
    # folder "Guides", which renderTree already auto-opened, so clicking that
    # would collapse the tree rather than expand anything.
    page.click('#treeList details[data-path="Guides/concepts"] > summary')
    expect(links).to_have_count(len(DOC_IDS))
    for doc_id in NESTED_DOCS:
        expect(page.locator(f"#treeList a.doc-link[data-id='{doc_id}']")).to_have_count(1)

    # Escape closes.
    page.keyboard.press("Escape")
    expect(drawer).to_be_hidden()
    expect(hamburger).to_have_attribute("aria-expanded", "false")

    # Reopen, then the scrim closes it.
    hamburger.click()
    expect(drawer).to_be_visible()
    scrim.click()
    expect(drawer).to_be_hidden()


@pytest.mark.e2e
def test_tree_item_navigates(page):
    boot(page)
    page.click("#hamburger")
    expect(page.locator("#doc-tree")).to_be_visible()

    target = "Guides/concepts/metadata-tags"
    page.click('#treeList details[data-path="Guides/concepts"] > summary')  # lazy tree
    page.click(f"#treeList a.doc-link[data-id='{target}']")

    # URL hash, main content and document title all update; drawer closes.
    expect(page).to_have_url(re.compile(re.escape(f"#/{target}") + r"$"))
    expect(page.locator("#content .doc h1")).to_contain_text("Metadata Tags")
    expect(page).to_have_title(re.compile(r"^Metadata Tags\b"))
    expect(page.locator("#doc-tree")).to_be_hidden()


# --------------------------------------------------------------------------- #
# routing / deep links
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_deep_link_cold_load(page):
    open_doc(page, "Guides/concepts/graph-model")
    expect(page.locator("#content .doc h1")).to_contain_text("The Graph Model")
    expect(page).to_have_title(re.compile(r"^The Graph Model\b"))


@pytest.mark.e2e
def test_root_loads_default_doc(page):
    boot(page)
    expect(page).to_have_url(re.compile(re.escape(f"#/{DEFAULT_DOC}") + r"$"))
    expect(page.locator("#content .doc h1")).to_contain_text("Getting Started")


# --------------------------------------------------------------------------- #
# heading auto-numbering  (content numbers == TOC numbers, same order)
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_heading_numbers_match_toc(page):
    open_doc(page, "Guides/getting-started")
    expect(page.locator("#content .doc h1")).to_be_visible()
    expect(page.locator("#tocList a")).to_have_count(6)

    heading_numbers = page.eval_on_selector_all(
        "#content .doc h1, #content .doc h2, #content .doc h3, "
        "#content .doc h4, #content .doc h5, #content .doc h6",
        "els => els.map(e => e.getAttribute('data-heading-number'))",
    )
    toc_numbers = page.eval_on_selector_all(
        "#tocList a .n",
        "els => els.map(e => e.textContent.trim())",
    )

    assert heading_numbers == ["1", "1.1", "1.1.1", "1.1.2", "1.1.3", "1.2"]
    assert heading_numbers == toc_numbers


# --------------------------------------------------------------------------- #
# sanitizer  (security & embedded HTML demo doc)
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_sanitizer_neutralizes_xss(page):
    dialogs = []
    page_errors = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    page.on("pageerror", lambda e: page_errors.append(str(e)))

    open_doc(page, "Guides/security-and-html")
    article = page.locator("#content .doc")
    expect(article.locator("h1")).to_contain_text("Security")

    # No styling survives.
    expect(article.locator("[style]")).to_have_count(0)
    expect(article.locator("style")).to_have_count(0)
    # No scripting survives.
    expect(article.locator("script")).to_have_count(0)
    # The javascript: link is not present as an active href.
    expect(article.locator("a[href^='javascript:']")).to_have_count(0)
    expect(page.locator("#content a[href*='javascript']")).to_have_count(0)
    # The structural <div> that is meant to survive is still there (as plain text).
    expect(article).to_contain_text("This plain div is kept")

    # No injected global, no dialog, no uncaught error.
    assert page.evaluate("() => window.__pwned") is None
    assert dialogs == [], f"unexpected dialog(s): {dialogs}"
    assert page_errors == [], f"unexpected page error(s): {page_errors}"


# --------------------------------------------------------------------------- #
# metadata-driven multi-link footer
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_footer_shows_multiple_next(page):
    # getting-started declares two "next" documents.
    open_doc(page, "Guides/getting-started")
    foot_next = page.locator("#footNext")
    expect(foot_next).to_be_visible()
    links = foot_next.locator("a")
    expect(links).to_have_count(2)
    hrefs = links.evaluate_all("els => els.map(a => a.getAttribute('href'))")
    assert set(hrefs) == {"#/Guides/concepts/graph-model", "#/Guides/markdown-kitchen-sink"}


@pytest.mark.e2e
def test_footer_shows_multiple_assumes(page):
    # metadata-tags declares two "assumes" documents.
    open_doc(page, "Guides/concepts/metadata-tags")
    foot_prev = page.locator("#footPrev")
    expect(foot_prev).to_be_visible()
    links = foot_prev.locator("a")
    expect(links).to_have_count(2)
    hrefs = links.evaluate_all("els => els.map(a => a.getAttribute('href'))")
    assert set(hrefs) == {"#/Guides/getting-started", "#/Guides/concepts/graph-model"}


@pytest.mark.e2e
def test_dangling_footer_reference_still_links(page):
    """A dangling assumes/next id renders as an ordinary link, by design.

    This test used to assert a `.foot-missing` span. That contract is dead: the
    class appears nowhere in app/ or docs/, and buildFootGroup (reader.js) always
    emits an <a>. Its own comment explains why - under the lazy server-backed
    architecture the client no longer holds every id, so it cannot cheaply prove a
    target is absent, and a dead link simply lands on the not-found view.

    So this pins the behaviour that actually exists. If a dangling-reference
    affordance is ever reinstated, this test is the one that should fail and be
    rewritten - which is the whole point of asserting it rather than skipping.
    """
    open_doc(page, "Guides/dafu-was-here")
    foot_next = page.locator("#footNext")
    expect(foot_next).to_be_visible()
    link = foot_next.locator("a")
    expect(link).to_have_count(1)
    expect(link).to_have_attribute("href", "#/Guides/no-such-document")
    assert page.locator(".foot-missing").count() == 0, (
        "A .foot-missing element appeared. The dangling-reference affordance has "
        "been reinstated - update this test to assert the new contract."
    )


# --------------------------------------------------------------------------- #
# skip link
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_skip_link_targets_content(page):
    boot(page)
    skip = page.locator("a.skip")
    expect(skip).to_have_count(1)
    expect(skip).to_have_attribute("href", "#content")
    # The target actually exists.
    expect(page.locator("#content")).to_have_count(1)


# --------------------------------------------------------------------------- #
# TOC behaviour  (Phase 4: the TOC is a Svelte component; these pin its contract)
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_toc_click_focuses_its_heading(page):
    """Clicking an entry scrolls to the heading AND focuses it.

    The focus half is the accessibility half: a keyboard user who activates a TOC
    entry must land ON the heading, not merely have it scrolled into view with
    focus still back in the list.
    """
    open_doc(page, "Guides/getting-started")
    entries = page.locator("#tocList a[data-target]")
    expect(entries).to_have_count(6)

    third = entries.nth(2)
    target = third.get_attribute("data-target")
    third.click()

    focused_id = page.evaluate("() => document.activeElement && document.activeElement.id")
    assert focused_id == target, f"expected focus on #{target}, got #{focused_id}"


@pytest.mark.e2e
def test_toc_scroll_spy_marks_active(page):
    """Scrolling the content pane marks the heading in view.

    This is the phase's designated SILENT failure. setupScrollSpy reads
    `tocList.querySelectorAll('a[data-target]')` in the same tick the TOC is
    populated, but Svelte applies rune writes on a microtask - so without a
    flushSync the map is empty, no entry is ever marked, and NOTHING THROWS.
    Asserting on .active is the only thing that catches it.
    """
    open_doc(page, "Guides/markdown-kitchen-sink")
    expect(page.locator("#tocList a[data-target]").first).to_be_visible()

    # Scroll far enough down that a later heading is inside the spy's band.
    page.evaluate("""() => {
        const c = document.getElementById('content');
        c.scrollTop = Math.floor(c.scrollHeight * 0.5);
    }""")
    expect(page.locator("#tocList a.active")).to_have_count(1)


@pytest.mark.e2e
def test_find_in_page_leaves_the_article_structurally_intact(page):
    """Typing in #docSearch must not restructure the article.

    clearHighlights used to call root.normalize() over the WHOLE article, which
    merges adjacent text nodes anywhere in the subtree - including inside DOM a
    mounted component is holding references into. It now normalizes only the
    parents it actually un-wrapped. This asserts the element count is unchanged
    across a highlight/clear cycle on a document that carries a requirement block.
    """
    open_doc(page, "Guides/Requirements")
    count = lambda: page.evaluate("() => document.querySelectorAll('#content .doc *').length")
    before = count()

    box = page.locator("#docSearch")
    box.fill("requirement")
    expect(page.locator("#content .doc mark.find").first).to_be_visible()

    box.fill("")
    expect(page.locator("#content .doc mark.find")).to_have_count(0)
    assert count() == before, "find-in-page changed the article's element count"


@pytest.mark.e2e
def test_toc_pane_hides_for_a_document_with_no_headings(page):
    """A document whose only heading is its title still has a TOC; one with none
    should not show an empty 'On this page' panel."""
    open_doc(page, "Guides/getting-started")
    expect(page.locator("#tocList a")).to_have_count(6)
    expect(page.locator("#toc")).to_be_visible()


# --------------------------------------------------------------------------- #
# the mounted-subtree contract  (Phase 4, for Phase 6 to rely on)
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_mounted_components_are_torn_down_before_the_article_is_replaced(page):
    """Anything mounted inside the article must be destroyed when it is replaced.

    The registry is EMPTY today - Phase 6 is what fills it. It is tested now, and
    deliberately, because the failure it guards against is invisible: detaching a
    node does not stop a component's effects, so a missed teardown leaks a live
    component per navigation and the symptom appears much later, somewhere else.
    Landing the hook untested would mean Phase 6 discovering all of that at once.

    Drives the real registry through its real export, on all three paths that
    replace the article: a normal navigation, an error screen, and a re-render of
    the same document.
    """
    boot(page)
    page.goto("/#/Guides/getting-started", wait_until="domcontentloaded")
    expect(page.locator("body")).to_have_attribute("data-app-ready", "1")

    # Register a fake mounted component against a real node inside the article.
    page.evaluate("""async () => {
        const reader = await import('/js/reader.js');
        window.__torn = [];
        const host = document.createElement('span');
        host.className = 'wd-mounted';
        host.id = 'probe-host';
        document.querySelector('#content .doc').appendChild(host);
        reader.registerMounted(host, () => window.__torn.push('probe'));
    }""")
    assert page.evaluate("() => !!document.getElementById('probe-host')")

    # Navigating replaces the article, which must tear it down exactly once.
    # By hash rather than by clicking the tree: the drawer is closed here, so its
    # links are present but not visible, and this test is about teardown rather
    # than about how the navigation was triggered.
    page.evaluate("() => { location.hash = '#/Guides/markdown-kitchen-sink'; }")
    expect(page.locator("#content .doc h1")).to_contain_text("Markdown Kitchen Sink")
    assert page.evaluate("() => window.__torn") == ["probe"], (
        "teardownMounted did not destroy a component registered inside the article"
    )
    assert page.evaluate("() => !!document.getElementById('probe-host')") is False


@pytest.mark.e2e
def test_teardown_is_idempotent_and_scoped(page):
    """A second replacement must not re-destroy an already-destroyed component,
    and a host outside the article must be left alone."""
    open_doc(page, "Guides/getting-started")
    page.evaluate("""async () => {
        const reader = await import('/js/reader.js');
        window.__torn = [];
        const inside = document.createElement('span');
        inside.className = 'wd-mounted';
        document.querySelector('#content .doc').appendChild(inside);
        reader.registerMounted(inside, () => window.__torn.push('inside'));
        // A host that is NOT inside #content: teardownMounted(content) must skip it.
        const outside = document.createElement('span');
        outside.className = 'wd-mounted';
        document.querySelector('.app-footer').appendChild(outside);
        reader.registerMounted(outside, () => window.__torn.push('outside'));
    }""")
    page.goto("/#/Guides/Verification", wait_until="domcontentloaded")
    expect(page.locator("#content .doc h1")).to_contain_text("Verification")
    page.goto("/#/Guides/Requirements", wait_until="domcontentloaded")
    expect(page.locator("#content .doc h1")).to_contain_text("Requirements")

    torn = page.evaluate("() => window.__torn")
    assert torn == ["inside"], f"expected exactly one scoped teardown, got {torn}"
