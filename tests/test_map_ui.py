"""End-to-end tests of the map / graph overlay.

This is the safety net that has to exist BEFORE the map's chrome is ported to
Svelte. The map is one <canvas>: there is no per-node DOM to query, so nothing a
normal Playwright selector can reach tells you whether the graph laid itself out,
whether a node is where the renderer thinks it is, or whether a click on it does
anything. `window.__graph` exists for exactly this - graph.js installs it as a
hit-test hook for the e2e driver and for nothing else - and until now no test in
this suite has ever touched it.

So these tests pin two contracts:

  * the OVERLAY contract - #graphOverlay reveals/hides, the canvas is there, the
    header button and Escape both close it, only one overlay is open at a time,
    and the chrome (legend, search box, edit toggle + hint) behaves; and
  * the HOOK contract - window.__graph.count/nodePositions/nodeAt/center/
    transform/setTransform/redraw, which is what lets a test turn a document id
    into screen pixels and click it.

Deliberately selected on CLASS NAMES and roles rather than on DOM order between
chrome elements: the port replaced the imperative builders in graph/chrome-view.js
with components that keep the class names but need not keep the sibling order.

The corpus is tests/fixtures/, mounted as the single source "Guides" by
tests/fixtures-config.json. Its eight documents carry real assumes/next
relationships, so the graph has real nodes and real edges.
"""
import math
import re

import pytest
from playwright.sync_api import expect

# The eight fixture documents, which are also the eight nodes of the map.
#
# The graph model comes from the SERVER index (GET /api/index/graph), whose edge
# tuples are node INDEXES - so `dafu-was-here`'s deliberately dangling
# "Guides/no-such-document" reference is dropped before the client ever sees it,
# and the map has no "missing" node. That is why this list is the whole corpus
# and nothing more.
MAP_DOC_IDS = {
    "Guides/Requirements",
    "Guides/Verification",
    "Guides/concepts/graph-model",
    "Guides/concepts/metadata-tags",
    "Guides/dafu-was-here",
    "Guides/getting-started",
    "Guides/markdown-kitchen-sink",
    "Guides/security-and-html",
}

# The node the pixel-level tests drive. Chosen because it is NOT the default
# document, so a navigation caused by clicking it is unambiguous, and because it
# has both an assumes and an incoming edge, so it is a genuine interior node.
PROBE_DOC = "Guides/concepts/metadata-tags"
PROBE_TITLE = "Metadata Tags"

# The edge categories the legend offers FOR THIS CORPUS. buildChrome only emits
# the "trace" entry when there are requirement-trace edges and the "pagelink"
# entry when there are page links; the fixtures have one page link and no traces,
# so "trace" is legitimately absent. prereq / recnext / missing are unconditional.
EXPECTED_LEGEND_KINDS = {"prereq", "recnext", "pagelink", "missing"}

# Every method graph.js parks on window.__graph. Asserted as a floor, not as an
# exact set: adding a hook later is fine, losing one is not.
HOOK_METHODS = [
    "nodeAt", "hitTest", "nodePositions", "center",
    "transform", "setTransform", "redraw", "count",
]


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def boot(page):
    """Load the app root and wait until it reports ready."""
    page.goto("/", wait_until="domcontentloaded")
    expect(page.locator("body")).to_have_attribute("data-app-ready", "1")
    return page


def open_map(page):
    """Boot, press the Map button, and wait until the graph is actually built.

    Two separate waits, because they are two separate things. The overlay is
    revealed synchronously on the click, but map-view.js is a DYNAMIC import and
    buildDocGraph awaits GET /api/index/graph before createGraph runs - so the
    canvas and the hit-test hook arrive a few ticks later. Waiting on the hook
    (rather than on a sleep) is what makes every test below deterministic.
    """
    boot(page)
    page.click("#graphBtn")
    expect(page.locator("#graphOverlay")).to_be_visible()
    page.wait_for_function("() => !!(window.__graph && window.__graph.count() > 0)")
    expect(page.locator("#graphOverlay .graph-root canvas.graph-svg")).to_be_visible()
    return page


def search_map(page, text):
    """Type into the map's search box, which centres the best-matching node."""
    box = page.locator("#graphOverlay .graph-search input")
    box.fill(text)
    return box


# --------------------------------------------------------------------------- #
# open / close
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_map_opens_from_the_header_button_and_toggles_shut(page):
    boot(page)
    overlay = page.locator("#graphOverlay")
    btn = page.locator("#graphBtn")

    # The HOST exists from first paint (overlays.ensureOverlayHosts), hidden.
    expect(overlay).to_have_count(1)
    expect(overlay).to_be_hidden()
    expect(btn).to_have_attribute("aria-pressed", "false")

    btn.click()
    expect(overlay).to_be_visible()
    expect(btn).to_have_attribute("aria-pressed", "true")

    # The scene is a canvas inside the stage, and the minimap is its own second
    # canvas - hence the explicit class, not a bare `canvas` selector.
    scene = page.locator("#graphOverlay .graph-root canvas.graph-svg")
    expect(scene).to_have_count(1)
    expect(scene).to_be_visible()
    expect(page.locator("#graphOverlay .graph-minimap canvas")).to_have_count(1)

    # The same button toggles it shut, and hands focus back to the article.
    btn.click()
    expect(overlay).to_be_hidden()
    expect(btn).to_have_attribute("aria-pressed", "false")


@pytest.mark.e2e
def test_escape_closes_the_map(page):
    open_map(page)
    page.keyboard.press("Escape")
    expect(page.locator("#graphOverlay")).to_be_hidden()
    expect(page.locator("#graphBtn")).to_have_attribute("aria-pressed", "false")


# --------------------------------------------------------------------------- #
# the window.__graph hit-test hook
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_map_installs_the_hit_test_hook(page):
    """The hook is the only handle a driver has on a canvas scene, so its whole
    surface is asserted - a method silently lost in a refactor is invisible
    otherwise."""
    open_map(page)
    missing = page.evaluate(
        "(names) => names.filter(n => typeof window.__graph[n] !== 'function')",
        HOOK_METHODS,
    )
    assert missing == [], f"window.__graph lost method(s): {missing}"

    # count() is the model's node count; nodePositions() is the laid-out set.
    # For this corpus they are the same eight documents.
    assert page.evaluate("() => window.__graph.count()") == len(MAP_DOC_IDS)
    ids = page.evaluate("() => Object.keys(window.__graph.nodePositions())")
    assert set(ids) == MAP_DOC_IDS
    assert len(ids) == len(MAP_DOC_IDS), f"duplicate node ids in the layout: {ids}"


@pytest.mark.e2e
def test_every_node_position_is_finite(page):
    """No NaN anywhere in the laid-out geometry.

    A real NaN bug lived in this layout code earlier in the migration, and it is
    the nastiest possible failure mode here: a NaN coordinate does not throw, it
    just makes the canvas silently refuse to paint that node and makes every
    hit test miss it. Nothing in the DOM changes. This is the assertion that
    turns that into a red test.
    """
    open_map(page)
    bad = page.evaluate("""() => {
        const out = [];
        const pos = window.__graph.nodePositions();
        for (const id of Object.keys(pos)) {
            const b = pos[id];
            for (const k of ['x', 'y', 'w', 'h', 'cx', 'cy']) {
                if (typeof b[k] !== 'number' || !Number.isFinite(b[k])) out.push(id + '.' + k + ' = ' + b[k]);
            }
        }
        return out;
    }""")
    assert bad == [], f"non-finite node geometry on the map: {bad}"

    # A zero-size box is unclickable and invisible, which is the same class of
    # silent failure as a NaN one.
    degenerate = page.evaluate("""() => {
        const pos = window.__graph.nodePositions();
        return Object.keys(pos).filter(id => !(pos[id].w > 0 && pos[id].h > 0));
    }""")
    assert degenerate == [], f"zero-sized node box(es): {degenerate}"

    # And the layout actually spread the nodes out rather than stacking them.
    distinct = page.evaluate("""() => {
        const pos = window.__graph.nodePositions();
        return new Set(Object.keys(pos).map(id => pos[id].cx + ',' + pos[id].cy)).size;
    }""")
    assert distinct == len(MAP_DOC_IDS), "the layout stacked nodes on top of each other"


@pytest.mark.e2e
def test_transform_is_finite_and_settable(page):
    open_map(page)
    t = page.evaluate("() => window.__graph.transform()")
    for k in ("tx", "ty", "k"):
        assert isinstance(t[k], (int, float)) and math.isfinite(t[k]), f"transform().{k} = {t[k]!r}"
    assert t["k"] > 0, f"the map opened at a non-positive zoom: {t}"

    # setTransform + redraw are how a driver frames the view; neither may throw.
    page.evaluate("() => { window.__graph.setTransform({ tx: 42, ty: -17, k: 1.5 }); window.__graph.redraw(); }")
    moved = page.evaluate("() => window.__graph.transform()")
    assert moved == {"tx": 42, "ty": -17, "k": 1.5}

    # setTransform guards each field with isFinite, so garbage is ignored rather
    # than poisoning the live transform. Pinning it here is cheap, and a lost
    # guard would otherwise surface as a blank map with nothing in the console.
    page.evaluate("() => window.__graph.setTransform({ tx: NaN, ty: undefined, k: 0 / 0 })")
    assert page.evaluate("() => window.__graph.transform()") == moved, (
        "setTransform let a non-finite value through"
    )


# --------------------------------------------------------------------------- #
# hit-testing and node activation
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_clicking_a_node_selects_its_document_without_leaving_the_map(page):
    open_map(page)
    # Centre the node first. The map opens fitted to the whole graph, so any
    # given node can land under the legend, the minimap or the zoom controls -
    # all of which sit at the edges, leaving the middle of the canvas the one
    # region that is always the scene itself.
    search_map(page, PROBE_TITLE)

    centre = page.evaluate("(id) => window.__graph.center(id)", PROBE_DOC)
    assert centre is not None, f"center() could not locate {PROBE_DOC}"
    assert math.isfinite(centre["x"]) and math.isfinite(centre["y"]), centre

    # The hit test agrees that those client pixels are that node. hitTest is
    # documented as an alias of nodeAt; assert that it still is one.
    hit = page.evaluate("(p) => window.__graph.nodeAt(p.x, p.y)", centre)
    alias = page.evaluate("(p) => window.__graph.hitTest(p.x, p.y)", centre)
    assert hit == PROBE_DOC, f"nodeAt at the node's own centre returned {hit!r}"
    assert alias == hit, "hitTest is no longer an alias of nodeAt"

    page.mouse.click(centre["x"], centre["y"])

    # A single click SELECTS: it routes to the document but stays on the map.
    # (Double-click is the one that closes it - not asserted here, because the
    # 350ms double-click window makes it a timing test rather than a DOM one.)
    expect(page).to_have_url(re.compile(re.escape(f"#/{PROBE_DOC}") + r"$"))
    expect(page.locator("#content .doc h1")).to_contain_text(PROBE_TITLE)
    expect(page.locator("#graphOverlay")).to_be_visible()


@pytest.mark.e2e
def test_empty_canvas_is_not_a_node(page):
    """The complement of the test above: a hit test off the graph misses.

    Without this, a nodeAt that returned the nearest node regardless of distance
    would pass every positive assertion in this file.
    """
    open_map(page)
    # Far outside the world bounds under any sane transform.
    assert page.evaluate("() => window.__graph.nodeAt(-5000, -5000)") is None


# --------------------------------------------------------------------------- #
# chrome: legend, search, edit mode
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_edge_legend_lists_its_categories_and_toggles_one(page):
    open_map(page)
    items = page.locator("#graphOverlay .graph-legend-item")
    kinds = items.evaluate_all("els => els.map(e => e.getAttribute('data-kind'))")
    assert set(kinds) == EXPECTED_LEGEND_KINDS, f"legend categories changed: {kinds}"
    assert len(kinds) == len(set(kinds)), f"duplicate legend entries: {kinds}"

    prereq = page.locator("#graphOverlay .graph-legend-item[data-kind='prereq']")
    expect(prereq).to_be_visible()
    expect(prereq).to_have_attribute("aria-pressed", "true")

    # Toggling a category off is draw-state on the canvas, so aria-pressed and
    # the .is-off class are the ONLY observable evidence it happened.
    prereq.click()
    expect(prereq).to_have_attribute("aria-pressed", "false")
    expect(prereq).to_have_class(re.compile(r"\bis-off\b"))

    prereq.click()
    expect(prereq).to_have_attribute("aria-pressed", "true")
    expect(prereq).not_to_have_class(re.compile(r"\bis-off\b"))


@pytest.mark.e2e
def test_map_search_centres_the_matching_document(page):
    open_map(page)
    search_map(page, PROBE_TITLE)

    # g.focus() puts the matched node in the middle of the canvas, so "did the
    # search find it" is answerable in pixels even though nothing in the DOM
    # changed.
    off = page.evaluate("""(id) => {
        const c = window.__graph.center(id);
        const r = document.querySelector('#graphOverlay canvas.graph-svg').getBoundingClientRect();
        return { dx: c.x - (r.left + r.width / 2), dy: c.y - (r.top + r.height / 2) };
    }""", PROBE_DOC)
    assert abs(off["dx"]) < 2 and abs(off["dy"]) < 2, (
        f"searching for {PROBE_TITLE!r} did not centre {PROBE_DOC}: offset {off}"
    )

    # A query that matches nothing must leave the view exactly where it was,
    # rather than jumping to whatever sorted first.
    before = page.evaluate("() => window.__graph.transform()")
    search_map(page, "zzz-no-such-document-anywhere")
    assert page.evaluate("() => window.__graph.transform()") == before, (
        "a search with no match moved the view"
    )


@pytest.mark.e2e
def test_edit_mode_reveals_the_edit_hint(page):
    open_map(page)
    toggle = page.locator("#graphOverlay .graph-edit-toggle")
    hint = page.locator("#graphOverlay .graph-edit-hint")
    root = page.locator("#graphOverlay .graph-root")

    expect(toggle).to_be_visible()
    expect(toggle).to_have_attribute("aria-pressed", "false")
    expect(hint).to_be_hidden()

    toggle.click()
    expect(toggle).to_have_attribute("aria-pressed", "true")
    expect(root).to_have_class(re.compile(r"\bis-editing\b"))
    # The hint is the only instruction a reader gets for a two-click gesture on a
    # canvas, so its TEXT matters, not merely its visibility. It names the armed
    # connector, which defaults to "recommended next".
    expect(hint).to_be_visible()
    expect(hint).to_contain_text("Recommended next")

    toggle.click()
    expect(toggle).to_have_attribute("aria-pressed", "false")
    expect(root).not_to_have_class(re.compile(r"\bis-editing\b"))
    expect(hint).to_be_hidden()


# --------------------------------------------------------------------------- #
# one overlay at a time
# --------------------------------------------------------------------------- #
@pytest.mark.e2e
def test_opening_the_coverage_view_closes_the_map(page):
    """Both views are full-screen overlays on the same stacking context, and both
    render a canvas graph into window.__graph. Two open at once is not a cosmetic
    problem - it is two live rAF loops fighting over the same global."""
    open_map(page)
    expect(page.locator("#covOverlay")).to_be_hidden()

    page.click("#covBtn")
    expect(page.locator("#covOverlay")).to_be_visible()
    expect(page.locator("#graphOverlay")).to_be_hidden()
    expect(page.locator("#covBtn")).to_have_attribute("aria-pressed", "true")
    expect(page.locator("#graphBtn")).to_have_attribute("aria-pressed", "false")
