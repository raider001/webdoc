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
  * requirement cards + traceability matrix (#reqBtn, requirements.js)
  * in-document search highlighting (#docSearch)
  * all-documents search index / tree filter (#treeSearch)
"""
import re

import pytest
from playwright.sync_api import expect

# Real document ids (source folder "Guides" + path, no extension).
DEFAULT_DOC = "Guides/getting-started"
DOC_IDS = [
    "Guides/Requirements",
    "Guides/Verification",
    "Guides/concepts/graph-model",
    "Guides/concepts/metadata-tags",
    "Guides/dafu-was-here",
    "Guides/getting-started",
    "Guides/markdown-kitchen-sink",
    "Guides/security-and-html",
]


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

    # Lists every document.
    links = page.locator("#treeList a.doc-link")
    expect(links).to_have_count(len(DOC_IDS))
    expect(page.locator("#treeList a.doc-link[data-id='Guides/getting-started']")).to_have_text(
        "Getting Started"
    )

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
def test_missing_footer_reference_is_flagged_non_link(page):
    """A dangling assumes/next id must render as .foot-missing (a span, not <a>).

    No document currently ships a dangling footer reference, so we scan the whole
    library: if one exists we assert it renders correctly; otherwise we skip
    honestly rather than fabricate a fixture (this suite may not edit docs/).
    """
    found = False
    for doc_id in DOC_IDS:
        open_doc(page, doc_id)
        missing = page.locator("#content ~ .app-footer .foot-missing, .app-footer .foot-missing")
        # Footer lives outside #content; locate globally.
        missing = page.locator(".foot-missing")
        if missing.count() > 0:
            found = True
            first = missing.first
            # It is a flagged NON-link: a <span>, never an <a>.
            tag = first.evaluate("e => e.tagName.toLowerCase()")
            assert tag == "span", f".foot-missing should be a <span>, got <{tag}>"
            expect(first).to_contain_text("⚠")
            break
    if not found:
        pytest.skip(
            "No document currently declares a dangling assumes/next reference, so "
            "the .foot-missing code path has no live fixture. Add a doc whose "
            "metadata references a non-existent id to exercise it."
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
