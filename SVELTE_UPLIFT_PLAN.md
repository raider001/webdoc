# WebDocs Uplift Plan: Svelte 5 + TypeScript

> **Status: plan, not execution.** Nothing in this document has been applied to the repository. It was produced on 2026-08-22 on branch `feature/svelte-uplift` (cut from `master` at d419cb9) by surveying every file under `app/`, measuring rather than estimating wherever measurement was possible.
>
> **Two tracks, one sequence.** Part I is the Svelte component migration. Part II is the JavaScript-to-TypeScript conversion. They are not independent projects — Part II's early steps are the safety net Part I depends on. The unified phase map below is the authoritative ordering; the per-track phase lists are the detail.
>
> Figures labelled **MEASURED** came from actually running the tool (`tsc`, `vite build`, `node`). Figures labelled **ESTIMATED** did not. Claims marked **(unverified)** were not confirmed against the source.

---

## Do this today, independent of everything else

`app/js/editor/serialize.js:79` contains a regex literal split across two physical lines:

```js
  const re = /`[^`
]*`/g;
```

A regex literal cannot span lines. This is a hard `SyntaxError`, and because `main.js` imports `editor.js` which imports `serialize.js`, **the entire application fails to load** — not just the editor. Verified:

```
FAIL app/js/editor.js    -> Invalid regular expression: missing /
FAIL app/js/authoring.js -> Invalid regular expression: missing /
FAIL app/js/main.js      -> Invalid regular expression: missing /
```

The intended semantics are not in doubt: the server-side twin at `webdoc_access.py:129` is `re.compile(r'`[^`\n]*`')`, and the code comment at `serialize.js:135-136` states the two must agree. The fix is to make the newline an escape — `/`[^`\n]*`/g` on one line.

Three notes:

- The defect is in **uncommitted working-tree changes** from the in-flight access-control work. `git show HEAD:app/js/editor/serialize.js` contains no `codeSpanRanges` at all, and HEAD parses cleanly.
- `node --check` returns **0** on this file. It does not validate regex literals, so a syntax check passes while the module cannot load. Verify with an actual dynamic `import()` instead.
- The Playwright suite *would* have caught it — all 13 e2e tests assert `body[data-app-ready="1"]`, which never gets set. The suite has not been run since that edit.

Separately, the JSDoc block at `serialize.js:73-77` was copy-pasted from the neighbouring `inFence(ranges, pos)`: it declares `@param ranges`, `@param pos` and `@returns {boolean}` above a function taking `body` and returning `[number, number][]`.

Neither defect is caught by anything the project currently owns. Both are caught in the first seconds of `tsc --noEmit`. That is the argument for Part II in miniature.

---

---

## Status: THE MIGRATION IS COMPLETE - Phases 0 through 8 all done

Final gates, run repeatedly and consistently:

| Gate | Result |
|---|---|
| `python -m pytest tests` | **173 passed** |
| `npx vitest run` | **30 passed** |
| `npx tsc --noEmit` | 0 errors |
| `npx svelte-check` | 0 errors |
| `npx eslint app/svelte` | clean |
| `npm run build` | reproducible, byte-identical |

Shape at the end: 38 Svelte components, 6 rune stores, 4 actions, 6 island mount surfaces, and 57 vanilla modules still doing the work they were always best at. The bundle is 142 kB raw / 40 kB gzipped and is git-tracked, which is what keeps `git clone && python serve.py` working with no Node installed.

**Phase 5 - auth.** Ten components. `tests/test_access_control.py` passed **unmodified** - all 107 tests, 1,073 lines of pure HTTP that never touch a DOM id, which is the strongest available signal for an auth port. All four non-negotiables held and were verified against a real accounts-enabled server: boot still `await`s the wall (`data-app-ready="0"` and an empty `#treeList` while it is up, so no library fetch leaves a locked-out browser), the wall resists Escape and backdrop clicks, the three `location.reload()` calls stayed, and rendering is text-node-only. The predicted input-id collision was real and is fixed with `$props.id()`.

**Phase 6 - requirement tables, coverage, runner.** The Phase 4 article contract got its first real consumer. `flushSync()` after mounting is mandatory, not tidiness: `revealRequirement` runs inside a single `requestAnimationFrame`, so an `$effect`-rendered table would land after it and a `?req=` deep link would fail silently.

**Phase 7 - the map.** `createGraph` became `createGraphController`, the chrome state machine became an emitter, both `container.textContent = ''` calls are gone, and `window.__graph` finally has one owner that clears it on destroy. Verified live: engine still absent at first paint, 42 nodes, no NaN, legend toggles, edit hint appears, and the hook is `null` after close.

**Phase 8 - documentation.** Row 6 amended in place; rows 9, 10, 11 **appended**, never inserted, so `sys_7` and `sys_8` keep their numbers and access-control's thirteen traces to `sys_8` still resolve. Fifteen documents amended. Most claims were left alone deliberately because they remain true - "no third-party Markdown library", "dependency-free server", "no build step for a document" all survive, correctly scoped.

### Corrections this plan needed, found by executing it

1. **The narrow-`include` TypeScript ratchet does not work.** `include` does not limit *checking*; tsc checks everything reachable through imports.
2. **Phase 2 step 4 was a downgrade and was not implemented.** Moving `?req=` into `location.search` would survive hash navigation, and assigning `location.search` reloads the document - turning every requirement link into a full app restart.
3. **The `doc._rev` justification was half wrong.** Only one of the two named paths reloads the document; the test-run path is correctly served by the `covStatus` tick, because the body has not changed - only pass/fail has.
4. **A freshness gate was vacuous for seven phases.** `git diff --exit-code` on an *untracked* path returns 0, so the Phase 1 bundle-freshness test passed while checking nothing. Now split: one test asserts the bundle is tracked and fails loudly, the other skips explicitly rather than passing silently.
5. **The `el('live')` count was 12, not 13** - one site binds the element to a local first, so a grep for `el('live')` misses it.
6. **The map chrome builder was not deleted, it moved.** `app/js/graph/chrome-view.js` still serves the *coverage* graph, which genuinely renders zoom controls, a search box and a minimap. The map's chrome is Svelte; the coverage graph's is not. `graph/chrome.js` now holds only the edit-state machine and is arguably misnamed.
7. **`createGraphController` takes the canvas's container, not a canvas**, because `render.js` was out of scope and is what creates and appends the canvas. The property that matters is enforced: the element is never cleared and destroy removes exactly the one canvas the engine added.

---

## Status: Svelte Phase 4 is DONE - satellites and the article contract

**pytest 142** (was 136: six new tests), **vitest 14**, `tsc` 0, `svelte-check` 0, ESLint clean, bundle builds.

The breadcrumb, the "On this page" TOC and both footer link groups are Svelte components. `app/js/numbering.js` lost `buildTOC` and its private `cssEscape` (90 to 62 lines); `reader.js` lost `renderFooter` and `buildFootGroup`. What stayed vanilla stayed for a reason: `numberHeadings()` still mutates the article, because it stamps ids and `.secnum` labels onto real headings - that is document CONTENT, not a panel.

**Mounted once, driven by props.** `#crumbs`, `#tocList`, `#footPrev` and `#footNext` are declared in `app/index.html` and live for the page's lifetime; only their contents change. The props are getters over the rune store, which is what makes mount-once work - passing `shellState.toc` by value would freeze the first document's TOC on screen for the session.

**The flush is load-bearing, and now has a test.** `setupScrollSpy` reads `tocList.querySelectorAll('a[data-target]')` in the same tick the TOC is set, but rune writes land on a microtask. Without `flushSync()` the map is empty, no entry is ever marked `.active`, and nothing throws. `test_toc_scroll_spy_marks_active` is the only thing that would catch it.

**`#live` got a plain vanilla owner**, `app/js/announce.js`, and all 13 writes migrated. Deliberately not a component: `authoring.js` and `map-view.js` must announce without importing anything compiled, and a live region re-rendered by a framework is a known screen-reader hazard. The real count was 13, not the 12 this plan states - `main.js`'s boot-failure handler binds the element to a local first (`const live = el('live')`), so a grep for `el('live')` finds only 12 of the 13 writes.

**The five article-contract changes, landed with zero mounts inside the article:**

1. `.wd-mounted` + `display: contents` in `requirements.css` - the host adds no box of its own, so it cannot break table or list layout it sits inside.
2. `clearHighlights` normalizes only the parents it un-wrapped, never the whole article. `root.normalize()` merges adjacent text nodes anywhere in the subtree, including nodes Svelte holds references into - the symptom would be a requirement table that silently stops updating after someone used find-in-page.
3. The find-in-page TreeWalker rejects `.wd-mounted`.
4. `resolveLinks` and `resolveImages` skip `.wd-mounted` subtrees.
5. `teardownMounted(root)` exists, is exported, and is called on **all three** paths that replace the article - `renderDoc`, `showRestricted` and `showError`. The plan named only `renderDoc`; the other two clear `#content` just as thoroughly.

**The teardown registry is empty and tested anyway**, which is the point. Two new Playwright tests drive the real registry through its real export: one proves a component registered inside the article is destroyed exactly once on navigation, the other proves teardown is idempotent across repeated navigations and *scoped* - a host outside `#content` is left alone. Phase 6 inherits a contract instead of inventing one.

**A verification note worth recording.** The in-app browser pane reports `#content.clientHeight` as 100px, which makes the scroll-spy's `-8%/-80%` rootMargin band about 12px tall - so scroll-spy appeared broken there, and a freshly-constructed observer with identical options also fired nothing. Under Playwright's real 1280x900 viewport it passes. Verify viewport-sensitive behaviour in the Playwright suite, not the browser pane.

New fixture content: `tests/fixtures/markdown-kitchen-sink.md` gained twelve filler sections purely so a document is tall enough to scroll in a 1280x900 viewport.

---

## Status: Svelte Phase 3 is DONE - the first real island

All gates green: **pytest 136**, **vitest 10**, `tsc` 0, `svelte-check` 0, ESLint clean, bundle builds.

The drawer tree and search results are now Svelte. `app/js/tree.js` went from 138 lines to 44 - reduced to the one thing that was never about rendering, `fetchChildren()`. `renderTree`, `folderNode`, `docLink`, `markActive`, `cssEscape` and the module-global `onSelectCb` are gone.

**This phase fixed a real bug, which is why it was worth doing first.** Expansion state used to live on the DOM: each folder's `open` attribute, plus a `loaded` flag on the element. But `renderTree()` began with `container.textContent = ''`, so every rebuild threw the tree away and collapsed every folder the reader had opened - on every document create, and on **every four-second external-change poll**. Expansion now lives in a rune store, so a rebuild is a data refresh rather than a teardown. Verified live: with `Docs` and `Docs/design` both open, `invalidateTree()` refetches and both stay open with their children intact.

Measured in the browser:

| Exit criterion | Result |
|---|---|
| Levels load lazily | 3 links at top level, 6 after expanding `design`; collapsed folders fetch nothing |
| Active document highlighted | `aria-current="page"`, exactly one at a time |
| Ancestors auto-expand on navigation | routing into a collapsed folder opens it |
| Expansion survives invalidation | `["Docs","Docs/design"]` before and after |
| Search debounces | 0 hits at 120ms, 2 hits after |
| Tree/results toggle | both restore correctly on clearing the box |
| Drawer stays vanilla | Escape closes, focus returns to `#hamburger`, `aria-expanded="false"`, overflow lock released, scrim hidden |

**The three things the phase existed to prove:**
1. **A rune store replacing module globals** - `app/svelte/stores/tree.svelte.js`.
2. **A keyed `{#each}` replacing hand-rolled DOM** - and `TreeFolder.svelte` recurses into itself for nested levels.
3. **The `/js/icons.js` seam** - `DocLink.svelte` imports `lockIcon` from `/js/icons.js` and renders it through a `use:icon` action, because icons.js returns a fresh element per call, which markup cannot express. The import stays external, so it is the same module instance the shell uses.

**The DOM contract was preserved deliberately**, and that is what let the existing Playwright suite pass unchanged: `a.doc-link[data-id]`, `.is-locked`, `.doc-lock`, `details[data-path]`, `.search-hit`, `.search-hit-title`, `.search-hit-sub`. The plan expected the drawer assertion at `test_e2e.py:123` to need updating; it did not, because Phase 0 had already corrected it to match the lazy tree.

**The search FETCH stayed vanilla in `main.js`** - the 200ms debounce, the `AbortController` and the sequence guard are subtle and correct and have nothing to do with rendering. Only the drawing moved. Both guards are retained: aborting only rejects the fetch, while a response that already parsed can still resolve late.

**A test of mine was wrong and had to be fixed.** `test_app_modules_are_not_inlined` used the identifier `lockIcon` as its sentinel for "icons.js was inlined". That broke the moment a component legitimately imported it, because the name then appears in the external import statement. The sentinel is now icons.js's SVG **path data**, which exists only inside the function bodies and therefore can only appear in the bundle if those bodies were copied in - which is the actual failure being guarded against.

Bundle: 38.21 kB to 60.33 kB raw (12.25 to 18.55 kB gzipped) for the five components, two stores and one action.

---

## Status: Svelte Phase 2 is DONE

**136 passed, 0 failed.** `tsc --noEmit` 0, `svelte-check` 0, ESLint clean, bundle rebuilds byte-identically.

**The eager import graph went from 53 modules / 12,528 lines to 36 / 7,738** - a 38% cut in what a reader downloads and parses to read one page. Measured in the browser via Resource Timing, not inferred:

| At first paint | Result |
|---|---|
| Heavy modules loaded (map-view, graph, editor, coverage-view, runner, report, coverage-report) | **none** |
| `graph/*` submodules | **0** |
| `editor/*` submodules | only `editor/richtext.js` (imports `dom.js` alone) |
| On pressing Map | `map-view.js` + `graph.js` + all six `graph/*` arrive exactly then |
| On pressing Coverage | its ten modules arrive exactly then |
| On pressing Edit | `editor.js` + four `editor/*` arrive exactly then |

Second and third clicks toggle correctly, confirming the listener-ownership fix: the lazily-loaded module no longer wires its own button, because the click that paid for the load is already over by the time it runs, and a second listener would make every later click toggle twice.

**The regression the plan predicted was verified as prevented**, not merely avoided: with the map never opened, `#graphOverlay` exists, `mapOpen()` returns false, and `requestMapRebuild()` is a silent no-op that does not fetch `map-view.js`. Previously three unguarded `!el('graphOverlay').hidden` reads in `authoring.js` would have thrown on the first create, save or delete.

**gzip** (step 2): ~485 kB saved per uncached visit. `/js/main.js` 21,707 to 7,829; `/css/app.css` 20,862 to 5,897; `/build/islands.js` 38,218 to 12,307; Markdown documents 44.8%. Decompressed bodies verified byte-identical, `Vary: Accept-Encoding` correct, PNG/WOFF2 untouched, HEAD still correct. serve.py stays stdlib-only.

**Two structural changes the plan did not specify, both of which made the rest possible:**

1. **`app/js/graph-model.js` extracted from `map-view.js`.** The server-backed graph MODEL (fetch, reshape, cache, invalidate) shared a file with the map VIEW but no code with it - while `map-view.js` statically imports `graph.js` and the whole `graph/*` pipeline. So `authoring.js` asking "what document ids exist?" and `main.js` dropping the cache after a file changed on disk each dragged ~2,000 lines of canvas renderer into the eager graph. Without this split, `map-view.js` could not go lazy at all.
2. **`combinedStatus` moved from `app-shell.js` to `coverage.js`.** `app-shell.js` is imported by five modules, so one line there for one function pulled the 464-line coverage engine into all of them.

`coverage-load.js` was NOT created. The plan proposed it so `loadResults` would not "drag in the report generator or the overlay" - but `coverage.js` imports only `auth.js`, so that was already true.

**Step 4 was deliberately NOT implemented as specified, and should be struck from the plan.** It proposed moving `?req=`/`?test=` out of the hash into `location.search`. That is a downgrade on three counts: `location.search` is not part of the hash, so it survives every later hash navigation and a stale `?req=` would name a requirement absent from the new page; **assigning `location.search` reloads the document**, turning every requirement link into a full app restart; and it breaks every existing deep link. The query belongs to the route, and the route is the hash.

The legitimate kernel - two hand-rolled regexes doing what a parser already does - was fixed: `reqFromQuery`/`testFromQuery` are replaced by one `routeParams()` built on `URLSearchParams`. Verified live: the deep link resolves its row, and navigating away drops the parameter entirely.

---

## Status: Svelte Phase 1 is DONE

The toolchain is proven independently of the framework. **136 passed, 0 failed** with the full toolchain, and — the load-bearing claim — **133 passed, 3 skipped** with `node_modules` moved aside and no `node` or `npm` on `PATH`. Only the three build-freshness tests skip, by design. That is `sys_9` demonstrated rather than asserted.

What landed: `package.json` (runtime `dependencies` an explicit `{}`), `package-lock.json`, `vite.config.js` with the `keepNative` externalisation plugin, `svelte.config.js` (runes-only), `jsconfig.json`, `eslint.config.js`, `.gitattributes`, `app/svelte/{entry.js,NoOp.svelte}`, the committed `app/build/islands.js`, the `app/js/islands.js` shim, and three new Python test files.

Verified on the artifact that actually ships, not on the docs:

| Property | Result |
|---|---|
| Rebuild is byte-identical | same sha256 across runs |
| `/js/icons.js` survives as an external import | first line of the bundle |
| `app/js/` is NOT inlined | `lockIcon` appears 0 times |
| `eval(` / `new Function(` / `import.meta` / sourcemap | 0 each |
| `app/build/` contents | exactly one file |
| Line endings | LF only, 0 CRLF |
| Island mounts, runs `$effect`, tears down | proven in the live app, no console errors |
| One shared module instance across shell and island | `import()` identity check passes |

**Corrected measurement — the runtime is bigger than §1 states.** Built twice, once with a Svelte component and once with an identical plain entry, and diffed: the delta is **38,575 bytes raw / 12,126 gzipped**, not the ~26 kB / ~10.3 kB recorded in §1. The difference is real, not noise: the earlier figure came from a component that used fewer runtime features, and this one uses a prop, `$state`, `$effect` and a snippet. It will keep moving as islands use more surface, so the honest requirement wording is a stated ceiling that CI enforces, not a fixed number. For scale, `app/js/` already ships **604,185 bytes** uncompressed on every cold load, so this is roughly 2%.

**Three deviations from §3, each deliberate:**

1. **No Prettier.** §3 lists it; the TypeScript track argues against a formatter on a codebase with a strong hand-written house style, and that argument wins. ESLint is included but **scoped to `app/svelte/` only** and carries safety rules rather than style ones — `svelte/no-at-html-tags` (the sanitizer bypass) and a `no-restricted-imports` rule mirroring the build-time externalisation guard. `app/js/` is not linted; `tsc --noEmit` checks its meaning instead.
2. **`jsconfig.json` sets `checkJs: false` and a `paths` mapping** of `/js/*` to `app/js/*`. Without the mapping `svelte-check` cannot resolve the root-absolute specifiers; with it, `app/js/` was pulled into a `strict: true` program and surfaced the `strictNullChecks` frontier that rung 4 defers. `checkJs: false` is the plan's own Vite-phase answer: TypeScript still parses the JSDoc for inference, so new Svelte code gets full types from the old code, while `app/js/` stays `tsconfig.json`'s territory.
3. **`app/js/islands.js` holds the bundle URL in a named constant** and imports it via a variable rather than a literal. The bundle is a build OUTPUT; a literal specifier makes the type-checker try to resolve it, and treating it as an input would make the build depend on its own result.

**The new tests earned their place immediately.** `test_runtime_dependencies_stay_empty` failed on its first run and caught a genuine `sys_10` violation: an `npm install` without `--save-dev` had put two ESLint packages into runtime `dependencies`.

---

## Status: Svelte Phase 0 is DONE

The suite is green: **122 passed, 0 failed** (`python -m pytest tests`) against the real `serve.py`, started by `conftest.py` itself, under the real Content-Security-Policy. That is 14 e2e + 1 conformance (**649/652, 99.54%**) + 107 access-control. `npx tsc --noEmit` remains at zero.

What landed:

- **`tests/fixtures/` — the suite now owns its corpus.** 8 documents mounted as the single source `Guides` by `tests/fixtures-config.json`, which also points the index at `.webdoc-index-test/` so a test run never clobbers the product's. The e2e suite had been targeting a `Guides` source that did not exist anywhere in the repository, so nothing it asserted was reaching real content. The XSS payload document lives here rather than in `docs/`, which is the whole reason a separate source was chosen over repointing.
- **`tests/conftest.py` rewritten.** Paths derive from `__file__` (it carried a hard-coded `C:/Users/panda/Web_Doc/app`), and it starts `serve.py` rather than falling back to `python -m http.server`. It also refuses to run against a server that is up but serving the wrong corpus, and waits for `/api/index/status` to report ready rather than merely for a socket.
- **Four `app/dev/*.html` harnesses de-inlined.** `_inline_script_hashes` hashes `app/index.html` only, so every inline script under `app/dev/` was CSP-blocked under the real server — the conformance harness would have sat on "Loading corpus…" for ever. Nine inline blocks became five external files (the three theme-boot scripts were byte-identical and share one).
- **Boot is diagnosable.** `boot()` was called unawaited with no `.catch`, so any rejection left `data-app-ready="0"` for ever and every Playwright test timed out with no reason. It now reports through `showError` and the live region, and asserts the template ids it requires.
- **Dead code removed.** `catalog.js`'s `discover`/`walk`/`makeDoc` (~53 lines, `discover` was an unused export).

**Two corrections to the Phase 0 spec below, both found by reading the code rather than assuming:**

1. The drawer test's `expect(links).to_have_count(len(DOC_IDS))` was wrong independently of the corpus. The tree is lazy — `renderTree` auto-opens only the **first source**, and nested folders are `<details>` whose children are fetched from `GET /api/index/tree?path=` on expand. The test now asserts the top level, expands `Guides/concepts` by `data-path`, and asserts the children then appear. Selecting the first `<summary>` would have *collapsed* the auto-opened source rather than expanding anything.
2. The `.foot-missing` assertions were replaced rather than deleted. The class is indeed dead, but `tests/fixtures/dafu-was-here.md` now carries a genuinely dangling `next` reference and the test pins the behaviour that actually exists — a dangling id renders as an ordinary link — with an explicit assertion that `.foot-missing` does **not** appear. If the affordance is ever reinstated, that test fails and asks to be rewritten, which a deletion could never do.

---

## Status: TypeScript rungs 0-2 are DONE

Executed 2026-08-22 on `feature/svelte-uplift`, before any Svelte work. `npx tsc --noEmit` reports **zero errors with `checkJs` + `noImplicitAny`** across all 53 modules in `app/js/`. 42 files changed, +1534/-250, annotation-only apart from named dead-code removals. No `any`, no `@ts-ignore`, no index signatures, no `@ts-nocheck`.

Measured, superseding the estimates below where they differ:

| Rung | Predicted | Measured |
|---|---|---|
| 1 - `checkJs`, `strict:false` | 581 | **597** -> 0 |
| 2 - `+ noImplicitAny` | +349 | **402** -> 0 |

Five structural fixes accounted for 423 of the 597: `GraphContext` decomposed into five composed stage typedefs (309 - it declared 20 properties against **105** actually attached, not the 81 estimated); `elem()` made generic over `keyof HTMLElementTagNameMap` (90); `interactions.js`'s `on()` helper made generic over `keyof GlobalEventHandlersEventMap` (21); `AppRegistry.updateDocActions` declared (3).

**Correction to §"TypeScript: configuration" below - the narrow-`include` ratchet does not work.** `include` does not limit *checking*: tsc type-checks every file reachable through imports, and all eight nominated strict-clean files import dirty ones, so the narrow config still reported the full error set. A working per-file ratchet needs `@ts-nocheck` pragmas removed one file at a time, or an error-count baseline in CI. Neither was needed here because the whole tree went to zero in one pass; the config now simply reads `"include": ["app/js/**/*.js"]`.

Verified beyond the type checker: all 53 modules parse under a real dynamic `import()`, and the running app was exercised at every touched surface - boot, reader, TOC, in-page find, map (42 nodes, no NaN positions, finite transform), coverage overlay, drawer tree, all-documents search, and a `serializeDoc` round-trip including both access markers.

Still outstanding from Part II: steps 10-15 (Vite, the `.ts` rename per surface, `strictNullChecks`). Those depend on the Svelte toolchain and have not started.

---

## The unified phase map

The two tracks interleave. TypeScript's rungs 0-2 land **before** the first Svelte component, because a type-checker that is already green makes every error in a later component PR unambiguously that PR's fault. If the checker arrives afterwards, its first 581 errors are indistinguishable from migration damage.

| Order | Track | Step | What lands | Node needed? | Runtime bytes changed |
|---|---|---|---|---|---|
| 1 | TS | Step 0 | Fix the unparseable `serialize.js` regex | no | yes (it starts working) |
| 2 | Svelte | Phase 0 | Green baseline: fixture corpus, dead-code removal, harness inline-script extraction | no | none |
| 3 | TS | Steps 1-8 | `tsconfig.json` + `package.json`, `GraphContext`, `app-shell.js`, types module, wire boundary — **rung 1: `tsc --noEmit` green at `strict:false`** | yes (dev only) | none |
| 4 | TS | Step 9 | `noImplicitAny` — **rung 2, the pre-Svelte target** | yes (dev only) | none |
| 5 | Svelte + TS | Phase 1 / Step 10 | Vite toolchain proof, committed bundle, node-free clone CI gate | yes (dev only) | first bundle |
| 6 | Svelte | Phase 2 | Performance + overlay contract (gzip, dynamic import split) — no Svelte behaviour | yes | yes |
| 7 | TS | Steps 11-12 | Pure-logic frontier and data/API layer convert to real `.ts` | yes | recompiled |
| 8 | Svelte | Phase 3 | First island: drawer tree + search results | yes | yes |
| 9 | Svelte | Phase 4 | Reader satellites + the mounted-subtree article contract | yes | yes |
| 10 | Svelte | Phase 5 | Auth screens | yes | yes |
| 11 | Svelte | Phase 6 | Requirement tables, coverage overlay, runner chrome | yes | yes |
| 12 | Svelte | Phase 7 | Map chrome (canvas engine wrapped, never ported) | yes | yes |
| — | TS | Step 13 | `.js` to `.ts` rename **rides inside each Svelte PR above**, never as a standalone conversion PR | — | — |
| 13 | TS | Step 14 | Hard stop-or-accept checkpoint after the graph wave | — | — |
| 14 | TS | Step 15 | `strictNullChecks`, per surface, deliberately last | yes | none |
| 15 | Svelte | Phase 8 | Remaining documentation and requirements amendment | no | none |

**Not in any phase: the WYSIWYG editor.** `app/js/editor/*` (1,767 lines of contenteditable, selection ranges and hand-rolled rich text) is explicitly out of scope. See Part I §6.7.

### Combined effort

| Track | Days |
|---|---|
| Part I — Svelte (Phases 0-8) | 35.0 |
| Part II — TypeScript (Steps 0-15) | 14.0 |
| Overlap: Step 13 rides inside Svelte PRs | −1.0 |
| **Total** | **~48** |

**Minimum defensible scope: ~22 days.** TypeScript rungs 0-2 (7 days) plus Svelte Phases 0, 1, 2, 3, 8 (15 days). That delivers a fully type-checked codebase, the toolchain, both performance wins, one proven island, six CI gates including a node-free clone test, and honest documentation — while leaving the map, coverage and auth surfaces hand-rolled until you want them.

The single most valuable property of this ordering: **everything up to and including order 4 changes zero runtime bytes and introduces no build step.** If the Svelte decision were reversed at that point, the type-safety work stands entirely on its own.

---

# Part I — Svelte

## 0. Complete disposition — every file under `app/`

53 JavaScript modules, 8 stylesheets, 4 dev harnesses, 17 standalone SVGs, 11 PNGs, one shell, two vendored-renderer files, one empty directory. Every one has a row.

### 0.1 The 53 modules under `app/js/`

| module | lines | disposition | phase |
|---|---|---|---|
| `commonmark.js` | 51 | **Frozen.** Parser entry. | — |
| `md/blocks.js`, `md/blockpost.js`, `md/inline.js`, `md/patterns.js`, `md/render.js`, `md/scan.js`, `md/tables.js`, `md/text.js` | 1,776 | **Frozen.** Provably DOM-free. | — |
| `sanitize.js` | 149 | **Frozen.** Security boundary. | — |
| `highlighter.js` | 94 | **Frozen.** | — |
| `highlight/lexer.js`, `highlight/grammars.js` | 567 | **Frozen.** | — |
| `doclinks.js` | 190 | **Frozen.** | — |
| `blocks.js` | 186 | **Frozen.** The fenced-block renderer registry — one of the eleven article passes, imported by `reader.js:13` and `app/thirdpartyrenderer/mermaid.js`. It performs its own defensive scrub of third-party output that is deliberately narrower than `sanitize.js` (it must keep `<svg>`). It is never a build input and never becomes a component; see §0.5 for why it is also the mermaid tripwire's real target. | — |
| `html.js` | 37 | **Frozen, and off-limits to components.** See §0.4. | — |
| `dom.js` | 75 | **Frozen.** `elem`/`append`, used by every vanilla module. | — |
| `icons.js` | 51 | **Frozen, imported by components through the native seam.** See §0.3. | — |
| `graph/render.js`, `graph/view.js`, `graph/layout.js`, `graph/util.js` | 1,619 | **Frozen** (dead exports in `util.js` cleared in Phase 7). | 7 (util only) |
| `graph/interactions.js` | 208 | **Split.** The canvas half (pointer, wheel, keyboard, hit-test, `ResizeObserver`) is frozen. The non-canvas half is two lines inside `destroy()`: `interactions.js:205`'s `g.container.textContent = ''` and `:206`'s `classList.remove('graph-root')`. Both move into `createGraphController`'s teardown and stop clearing a container Svelte owns. | 7 |
| `graph/chrome.js` | 244 | **Ported.** Builder half deleted; state machine inverted to an emitter. | 7 |
| `graph.js` | 244 | **Refactored** to `createGraphController(canvasEl, …)`. | 7 |
| `map-view.js` | 260 | **Ported** (chrome) + kept (model helpers). Overlay-creation moves in Phase 2. | 2, 7 |
| `panzoom.js` | 188 | **Frozen.** Its only importer is `app/thirdpartyrenderer/mermaid.js`. Not part of the map surface; do not unify. | — |
| `tree.js` | 138 | **Ported.** Reduced to the fetch helper. | 3 |
| `search.js` | 44 | **Frozen.** Imports as-is. | — |
| `catalog.js` | 173 | **Edited, not frozen.** Phase 0 deletes ~53 lines of dead `discover`/`walk`/`makeDoc`; Phase 6 adds `doc._rev++` inside `loadDoc`. | 0, 6 |
| `numbering.js` | 90 | **Split.** `numberHeadings` kept; `buildTOC` deleted, its click behaviour reproduced (§0.6). | 4 |
| `reader.js` | 321 | **Edited in three phases.** Satellites removed (4); mounted-subtree contract added (4); requirement bridge (6). | 3, 4, 6 |
| `app-shell.js` | 131 | **Kept, extended.** Gains a plain change emitter (§6.1) and loses its static `coverage.js` import (Phase 2). `downloadFile()` and `isoDate()` stay exactly where they are — `coverage-view.js:7` is their only importer and it keeps importing them from `/js/app-shell.js` after the port. | 2, 6 |
| `main.js` | 429 | **Kept vanilla, edited in every phase.** Boot stays one awaited function. | 0, 2, 3, 4, 5, 7 |
| `plugins.js` | 37 | **Frozen, never a build input.** See §0.5. | — |
| `auth.js` | 366 | **Frozen.** Bridged, not rewritten. It is *not* DOM-free: `auth.js:220` reads `document.cookie` and `auth.js:294-296` calls `getComputedStyle(document.documentElement)` to read `--group-sat`/`--group-light`. Both survive untouched. | — |
| `auth-ui.js` | — | **Ported**, retaining `groupChip` under its existing name. | 5 |
| `authoring.js` | 457 | **Call sites rewired, logic not restructured.** See §0.7. | 2, 3, 4 |
| `coverage.js` | 445 | **Frozen.** No DOM. | — |
| `report.js` | 272 | **Frozen, but not DOM-free.** `report.js:32-34` and `:37-39` build a `div`, append a sanitized fragment and return `innerHTML`. That is a fragment→string round trip inside the frozen zone; it is safe only because the string is written to a downloaded file and never re-parsed into this document. It also means `report.js` cannot be tested without a DOM — its guard test is a browser test, not a Python one (§7). | — |
| `coverage-view.js`, `coverage-report.js`, `runner.js` | 715 | **Ported.** | 6 |
| `requirements.js`, `requirements/parse.js`, `requirements/render.js` | 740 | `requirements.js` and `parse.js` frozen; `render.js` gains the mount bridge. | 6 |
| `requirements/store.js` | 40 | **Stays vanilla, stays named `store.js`.** See §0.8 — the rename in the previous draft was impossible. | 6 |
| `editor.js`, `editor/panels.js`, `editor/richtext.js`, `editor/serialize.js`, `editor/ui.js`, `editor/widgets.js` | 1,767 | **Out of scope entirely.** See §6.7. | — |

Sum check: 53 rows of modules, 53 files on disk (`find app/js -name '*.js' | wc -l` = 53).

### 0.2 The 8 stylesheets, the shell, and everything else under `app/`

| path | lines | disposition |
|---|---|---|
| `app/index.html` | 83 | **Byte-identical.** 8 `<link rel=stylesheet>` tags at lines 18-25, one inline theme script at 9-17, one `<script type="module" src="/js/main.js">` at 81. Not a build input, not rewritten, no tag added. |
| `app/css/app.css` | 373 | **Global, edited only for new chrome rules.** Owns the drawer, header, footer, TOC pane, and the `.tree summary::before` / `.tree details[open] > summary::before` chevrons at `:209-210` that are the reason `<details>` survives the tree port. |
| `app/css/auth.css` | 184 | **Global.** Split *logically* in Phase 5 (documented ownership comments), not split into files. `:root --group-sat`/`--group-light`/`--locked-bg` must stay in `:root`. `.doc-lock`/`.is-locked` are consumed by the Phase 3 tree, so Phase 3 reads this file even though Phase 5 owns it. |
| `app/css/blocks.css` | 90 | **Global, frozen.** Styles `blocks.js` output inside the article. Svelte never enters it. |
| `app/css/graph.css` | 225 | **Global, edited in Phase 7.** It styles exactly the chrome Phase 7 replaces. The port must keep every selector name — the transcription principle (§6.1) applies to CSS class names as strictly as to ids. |
| `app/css/highlight.css` | 54 | **Global, frozen.** Token classes emitted by the frozen highlighter. |
| `app/css/coverage.css` | 145 | **Global, edited in Phase 6.** Defines the `--cov-*` tokens `requirements.css` consumes. |
| `app/css/requirements.css` | 81 | **Global, edited in Phase 6.** |
| `app/css/editor.css` | 166 | **Global, frozen** (editor out of scope). |
| `app/dev/conformance-full.html` | — | Inline scripts extracted to `app/dev/conformance-full.js` in Phase 0. |
| `app/dev/conformance.html` | — | Two inline scripts (`:9` plain, `:89` module importing `renderMarkdown, INTERIM`). Extracted in Phase 0. |
| `app/dev/graph-demo.html` | — | Inline module extracted in Phase 0; **rewritten in Phase 7** — `:54` imports `createGraph` from `/js/graph.js` and `:75` calls `createGraph(stage, docs, {...})` with a container `div`. Phase 7 replaces that signature and deletes both `container.textContent = ''` calls, so this harness breaks silently unless it is ported in the same PR. `:93` sets `window.__graph` — the only place in the repository outside `graph.js:207-209` where that name appears. |
| `app/dev/highlight-demo.html` | — | Inline module (`:155-168`, imports `highlightWithin`) extracted in Phase 0. Never otherwise touched — the highlighter is frozen. |
| `app/dev/corpus.json`, `app/dev/commonmark-spec.json` | — | Data fixtures. Never touched. |
| `app/icons/*.svg` | 17 files | **Hand-maintained twins of `icons.js`, and they stay that way.** Nothing in the plan creates a third copy; see §0.3. |
| `app/assets/how-to/*.png` | 11 files | Documentation screenshots. Never touched. Note that several show chrome this plan re-renders; if a port changes any pixel of the drawer, TOC or map toolbar, the corresponding screenshot is stale. Ship behaviour-identical and they stay correct. |
| `app/data/` | empty | **Empty directory, served world-readable.** It sits under `APP_DIR`, so `route()` at `serve.py:1038` would serve anything placed in it *before any ACL check* — the same exposure `app/build/` and `app/svelte/` have. Leave it empty; add a `.gitkeep` with a one-line comment saying nothing private may go here. |
| `app/thirdpartyrenderer/README.md`, `mermaid.js` | — | Frozen. The bring-your-own contract is non-goal 12. |
| `app/thirdpartyrenderer/mermaid.min.js` | 3,565,102 bytes | Gitignored (`.gitignore:7`). Present locally, absent in CI. |
| `app/build/islands.js` | new | Committed build output. Exactly one file in that directory, ever. |
| `app/svelte/**` | new | Sources. Fetchable over HTTP (§9). |

### 0.3 How a `.svelte` component gets an icon

`icons.js` is imported by 12 modules, six of which this plan ports (`tree.js` P3, `auth-ui.js` P5, `requirements/render.js` + `coverage-report.js` + `runner.js` P6, `graph/chrome.js` P7). It returns **DOM nodes**, one fresh node per call, and its own header records that every icon has a byte-identical twin under `app/icons/*.svg` kept in sync by hand.

**The rule: components import `/js/icons.js` and insert the returned node through an action. They never re-inline the markup.**

This is safe precisely because of `keepNative`. The specifier `/js/icons.js` is marked external, so the compiled bundle emits `import { closeIcon } from "/js/icons.js"` and the *browser* resolves it to the same module instance `main.js` already loaded. There is no bundled copy, therefore no duplicate-module-instance hazard — that hazard only exists for *relative* imports that reach into `app/js` and get inlined, which `keepNative` refuses outright.

`app/svelte/actions/icon.js`:

```js
// Insert an icons.js node. The factory is imported from "/js/icons.js" (external
// under keepNative), so there is exactly one icons module and exactly one copy of
// every icon's markup in the repository. NEVER re-inline icon SVG in a component.
export function icon(node, factory) {
  let cur = factory();
  node.prepend(cur);
  return {
    update(next) { const n = next(); cur.replaceWith(n); cur = n; },
    destroy() { cur.remove(); }
  };
}
```

Used as `<button use:icon={closeIcon} class="icon-btn">…</button>`. Adding a new icon still means editing `icons.js` **and** `app/icons/`, exactly as today. The count of hand-synced copies stays at two.

`index.html` itself carries five hand-drawn inline SVGs (`:42` `#newDocBtn`, `:43` `#covBtn`, `:44` `#graphBtn`, `:46` `#themeBtn`, `:55`/`:56` the edit and delete buttons, `:69` `#drawerClose`). Those are in the shell, which stays byte-identical, so they are not touched and not migrated to `icons.js`.

### 0.4 `html.js` at a Svelte boundary

`html.js` is a 37-line tagged-template builder producing a `DocumentFragment` with **child slots only** — `${value}` fills a child position exactly as `dom.js`'s `append()` does; a `Node` (or array) is inserted as-is, anything else becomes an escaped text node, `null`/`undefined`/`false` are skipped, and there is **no attribute interpolation**. Its importers are `main.js`, `icons.js`, `report.js`, `requirements/render.js`, `runner.js`, `coverage-report.js`.

**Disposition: frozen, and off-limits to `.svelte` files.** A component that wants markup writes markup. `html.js` survives because `icons.js` and `report.js` depend on it and both are frozen; because `main.js` stays vanilla; and because the three ported modules (`requirements/render.js`, `runner.js`, `coverage-report.js`) each retain a vanilla remnant. No component imports it, and no component's output is ever passed into an `html` slot — the slot contract inserts a node *as-is*, which would hand a Svelte-owned node to code that may later discard it without unmounting.

### 0.5 `plugins.js` and the thirdpartyrenderer tripwire, corrected

`plugins.js` (37 lines) is **frozen and is never a build input**. The previous draft listed a `/* @vite-ignore */` comment at `plugins.js:29` as one of three guards. That is a no-op: Vite only honours `@vite-ignore` on dynamic imports it actually processes, and under this strategy it never processes this file. Drop it. There are **two** real guards, plus lint:

1. `rollupOptions.external` for `app/thirdpartyrenderer/**` — fires only if someone makes the folder reachable from the entry.
2. The folder is not in the build tree, and `app/svelte/**` never imports from it. Enforced by the same eslint `no-restricted-imports` rule that forbids relative reaches into `app/js`.

The hazards the guards exist for are all real and were verified: `plugins.js:29`'s `await import(\`../thirdpartyrenderer/${name}.js\`)` has a static prefix *and* suffix, so Rollup would glob the folder; `app/thirdpartyrenderer/mermaid.js:19` imports `../js/blocks.js`, and a bundled second copy of that registry means diagrams silently render as plain code blocks with no error; `mermaid.js:35` uses `new URL('./mermaid.min.js', import.meta.url)`, which breaks under any chunk hashing; and `mermaid.min.js` is 3,565,102 bytes and gitignored, so a build that reached it would succeed locally and fail on the runner.

### 0.6 Behaviour that must be reproduced, not just re-rendered

Four pieces of behaviour live inside functions this plan deletes. Each is named here so no phase can lose it silently.

| deleted function | behaviour beyond markup | who reproduces it |
|---|---|---|
| `tree.js:118-133` `markActive` | force-loads each collapsed ancestor via `details._load()`, **and** calls `link.scrollIntoView({ block: 'nearest' })` on the target | Phase 3: ancestor expansion becomes `expandTo()`; the scroll is an explicit `$effect` on the active link's `bind:this` node. |
| `numbering.js:68-81` `buildTOC` click handler | `preventDefault`, `scrollIntoView({block:'start', behavior:'smooth'})`, stamps `tabindex="-1"` on the heading, `focus({preventScroll:true})` | Phase 4: identical handler inside `Toc.svelte`. The `data-target` attribute and the `<span class="n">` wrapper are contract — `tests/test_e2e.py:176-193` asserts both. |
| `main.js:98/100/110` `setupDrawer` | captures `document.activeElement` on open and calls `lastFocus.focus()` on close | Phase 3: `setupDrawer` **stays vanilla in `main.js`**, including the focus restore. Only the tree/search *rendering* moves. |
| `coverage-view.js:58-63` export button + `:169-184` `exportReport` | builds `.cov-export-btn`, calls `generateReportHtml()` then `downloadFile()` from `app-shell.js:101` | Phase 6: `CoverageOverlay.svelte` renders the button; the click handler calls a plain `exportReport()` that `coverage-view.js` still exports and that still imports `downloadFile`/`isoDate` from `/js/app-shell.js`. |

### 0.7 The `authoring.js` scope boundary, stated once

`app/js/authoring.js` (457 lines) is **not converted to components and its CRUD logic is not restructured.** Three phases rewrite named call sites inside it, and nothing else:

- **Phase 2** — `:93`, `:125`, `:304`, the three unguarded `el('graphOverlay').hidden` reads, become `mapOpen()` / `requestMapRebuild()`. (`main.js:354-355` already guards correctly: `const overlay = el('graphOverlay'); if (overlay && !overlay.hidden)`. It changes for consistency, not because it is broken.)
- **Phase 3** — `:39-40`, `rerenderTree` becomes `invalidateTree()`.
- **Phase 4** — the five `el('live').textContent =` writes at `:120`, `:121`, `:124`, `:290`, `:297` become `announce(…)`.
- **Phase 2** also removes its static `import { openEditor, … } from './editor.js'` and `import { buildDocGraph, … } from './map-view.js'` at `:9-10`, which are what actually hold the editor and graph stacks in the eager graph.

**Non-goal 4 covers `app/js/editor.js` and `app/js/editor/**` only.** It does not and never did cover `authoring.js`.

### 0.8 No runes file may live under `app/js/`

`keepNative` marks every `/js/` specifier external, and `serve.py:1038` serves those files verbatim. Runes are **compiler syntax**, not runtime functions — a raw-served file containing `$state(...)` is a `ReferenceError` in the browser. The alternative, compiling it into `islands.js`, gives its plain importers a second uncompiled copy: the duplicate-module-instance corruption this plan rates Critical.

**Rule: `.svelte` and `.svelte.js` files exist only under `app/svelte/`. `app/js/` contains no runes, ever.** The eslint config enforces it with a path-scoped rule, and the build test asserts that no emitted file references a source outside `app/svelte/`.

The previous draft's `app/js/requirements/store.js` → `store.svelte.js` rename is therefore withdrawn. `store.js` keeps its name, its location and its three vanilla importers (`requirements/parse.js:9`, `requirements/render.js:11`, `requirements.js:26` and `:29`). Reactivity reaches it the same way it reaches `auth.js`: a plain listener array in the vanilla module, mirrored into a rune store under `app/svelte/stores/`. See §2.

### 0.9 CSS for components

**`.svelte` files carry no `<style>` block.** Not one, anywhere in this plan.

All CSS stays in `app/css/*.css` as global stylesheets loaded by the eight `<link>` tags in the byte-identical shell. A new rule goes into the stylesheet that already owns that surface: drawer/TOC/footer/header → `app.css`; map chrome → `graph.css`; coverage overlay and report panel → `coverage.css`; requirement tables and badges → `requirements.css`; auth screens and group chips → `auth.css`.

This is not stylistic preference. `auth.js:294-296` reads `--group-sat`/`--group-light` off `documentElement` via `getComputedStyle`, and `requirements.css`'s `.tc-result-*` consumes `--cov-*` defined in `coverage.css`. A token that moves into a component's scoped `<style>` leaves `:root` and the colour silently falls back. `emitCss: false` stays in the Vite config as a tripwire, and the build test asserts the bundle contains no injected-style call — if someone adds a `<style>` block, the build test fails rather than the colours quietly changing.

### 0.10 Runtime directories

`.webdoc-index/` (gitignored, `.gitignore:8`; contains `index.db`, `index.db-shm`, `index.db-wal`) and `.webdoc-auth/` (gitignored, `.gitignore:14`) are **absent from a fresh clone**. That matters for exactly one thing in this plan, and it is Phase 1's flagship gate: on a cold clone `serve.py` builds the SQLite index in the background and answers **503 for every `/api/index/*`** until it finishes (`serve.py:492`), which is why `boot()` shows the index overlay and `awaits waitForIndex()` before anything else. The node-free clone gate must therefore poll `/api/index/status` until `generation` is a number and the build has completed, with an explicit timeout, *before* asserting `body[data-app-ready="1"]`. Without that precondition the gate is a race that passes on a warm machine and fails in CI.

Neither directory is ever a build input, ever committed, or ever served — both sit outside `APP_DIR`.

---

## 1. The decision and its cost

### What is actually being traded away

Two constraints. They are not the same constraint and they do not cost the same amount.

**Constraint A — zero third-party runtime dependencies.** This is only being *narrowed*, and only for the browser half. The server keeps it absolutely: `serve.py`, `webdoc_index.py`, `webdoc_auth.py` and `webdoc_access.py` remain Python-standard-library-only, and `package.json`'s runtime `dependencies` object stays literally `{}` forever. What ships to the browser gains exactly one thing: the compiled Svelte 5 client runtime.

That runtime was **measured, not estimated**. Building the same entry twice — once with a Svelte component in the graph, once without — and diffing the output gives:

| build | raw | gzip |
|---|---|---|
| entry with Svelte | 27.65 kB | 11.18 kB |
| identical entry without Svelte | 1.68 kB | 0.92 kB |
| **delta = the Svelte 5 client runtime** | **~26 kB** | **~10.3 kB** |

Put that literal number in the requirement. "Some framework runtime" is not auditable; `~10 kB gzipped` is.

For scale: `find app/js -name '*.js' | xargs cat | wc -c` = **563,149 bytes** of raw, uncompressed, un-gzipped JavaScript that the app already ships on every single cold load (`_file` at `serve.py:855` does a bare read-and-send; only `_json` compresses, at `serve.py:316-325`).

**Constraint B — no build step.** This is the expensive one, and it cannot be narrowed away. It splits three ways:

| audience | before | after |
|---|---|---|
| reading / authoring a document | no build step | **unchanged — still no build step** |
| running / operating the server | no build step | **unchanged — because `app/build/islands.js` is committed** |
| developing the browser app | no build step | **now has a build step, and needs Node** |

Only the third row changes. A contributor can still edit `serve.py`, any of the 53 modules under `app/js/`, any file in `app/css/`, or any Markdown document, hit refresh, and see the result — that property is preserved by the chosen strategy and is not preserved by the alternatives. What dies is editing a `.svelte` file without Node.

**One caveat that must be stated rather than glossed:** a clean clone already does *not* render mermaid diagrams. `config.json` enables the `mermaid` plugin, `.gitignore:7` excludes `app/thirdpartyrenderer/*.min.js`, and `plugins.js:31-34` logs-and-skips a missing library — so every mermaid fence falls back to a plain code block until an operator drops the library in. That is the bring-your-own contract working as designed, and it is unchanged by this plan. "Clone and run one python file" is true; "with every feature" is not, and never was.

### The exact sentences that become false

**`docs/requirements/system.md` line 31, R_WD_SYS_6:**

> WebDocs shall ship with zero third-party runtime dependencies.

**`docs/overview.md` line 21:**

> no build step, no bundler

**`docs/overview.md` lines 34-38** — the "Zero third-party runtime dependencies" pillar.

**`docs/design/architecture.md` lines 118-127** — "The zero-dependency principle", which currently states there is no framework and no third-party runtime code anywhere in the browser application.

**`docs/design/parser.md` line 8** — "no library, no dependency, no shortcuts" (of the parser). Still true of the parser; the surrounding framing is not.

**`docs/requirements/functional/highlighting.md` line 7** — "hand-written syntax highlighters". Still true; audit for framing.

**`docs/reference/performance.md` lines 19-20**, which enumerates "zero third-party runtime dependencies, no Node, a standard-library-only server, no build step" as the box the SQLite index work was deliberately held inside.

**`tests/README.md` lines 7-10** ("There is no Node.js, no npm, no `package.json`"), **line 10** again ("two additional harness files under `app/dev/`" — there are four `.html` harnesses), **line 51** ("download Playwright's own Chromium (no Node involved)" — still true of Playwright, false as a statement about the repository), the comment block in **`tests/requirements-dev.txt`**, and **`.gitignore` lines 1-6**, whose comment claims excluding the vendored libraries "preserves the *nothing but hand-written vanilla JS ships* guarantee for a clean clone."

**`tests/test_conformance.py` line 5** — "hand-written parser". Still true; it is in the audit table so the claim is re-read rather than assumed.

All of these land in **Phase 1**, in the same commit as `package.json`. Phase 8 handles the remainder. See §5.

### Proposed replacement wording

Do not widen SYS_6 until it is vacuous. Amend one row and **append** three.

The identifier scheme forces this. `docs/requirements/system.md:15-19` states each row composes `R_WD_SYS_{no}` where `{no}` is the value in the first column, and `requirements/parse.js:238` builds `'R_' + component + '_' + group + '_' + no` from that same cell. Inserting rows in the middle renumbers rows 7 and 8 — and `sys_8` is the trace-to target of **all twelve rows** of `docs/requirements/functional/access-control.md:21-32`, with `sys_7` also live. Renumbering silently repoints every one of those traces and the app renders the wrong links with no error. So: rows 1-8 keep their numbers, row 6's *text* is amended in place, and the new rows are 9, 10, 11.

| id | text |
|---|---|
| `sys_6` (amended, row 6 unchanged in position) | WebDocs shall depend on no third-party code at run time on the server, and shall ship no third-party code to the browser beyond the compiled UI framework runtime (Svelte 5, measured at ~26 kB raw / ~10.3 kB gzipped). |
| `sys_9` (new row 9) | WebDocs shall remain runnable from a clean clone with a Python 3 interpreter alone; the compiled browser bundle shall be committed to the repository. |
| `sys_10` (new row 10) | Third-party packages shall be build-time-only development dependencies; the package manifest's runtime `dependencies` object shall remain empty. |
| `sys_11` (new row 11) | The server shall remain Python-standard-library-only and shall run with no Node.js installed. |

`sys_9` is the load-bearing one. It is the property readers actually cared about when they read SYS_6, and unlike the old prose it is mechanically testable — Phase 1 makes it a CI gate (fresh clone into a container with no `node` binary, no `node_modules`, no network, `python serve.py`, **wait for the cold index build to finish**, run the HTTP suite, assert `body[data-app-ready="1"]`). That test is also the only thing that would catch someone quietly adding `app/build/` to `.gitignore` in eighteen months.

### If you would rather not pay this

There is a real, non-trivial answer that costs nothing. `app/js/dom.js` (75 lines, `elem`/`append`) and `app/js/html.js` (37 lines, tagged template producing a `DocumentFragment` with child slots) are already a competent hand-rolled builder pair, and most of what Svelte would delete from this codebase is not markup construction — it is *manual state-to-attribute syncing*: 12 `el('live').textContent =` sites, roughly 41 `.hidden =` assignments across `app/js` (12 of them in `coverage-report.js` alone), three `aria-pressed` mirrors, `markActive`'s querySelectorAll-clear-then-set scan, `pfControl.sync()`/`syncPill()`/`updateProgress()` in `app/js/runner.js`. A ~60-line signals module (a `signal()`/`computed()`/`effect()` pair over the existing `onAuthChange` listener pattern in `app/js/auth.js`) plus `dom.js` would remove a large fraction of that with zero build step and zero new constraint. Separately — and this is the honest sting — the single largest *performance* win available is not Svelte at all: `app/js/main.js` statically imports 18 modules, so every reader downloads and parses the 1,767-line editor, the ~2,300-line canvas graph and the ~2,200-line coverage/requirements stack in order to read one paragraph. Deferring those behind their existing buttons is available today and needs no bundler — though, as Phase 2 discovers, it is a real refactor rather than a one-file change. What the no-Svelte path does *not* give you: a compiler that makes the one-owner-per-attribute rule structural rather than a convention, keyed list reconciliation that moves DOM nodes on reorder instead of destroying them, or `svelte-check`. The user has asked for Svelte; this paragraph exists so the trade is on the record, not to argue against it.

---

## 2. Target architecture

### Strategy: Strangler Fig, native-ESM islands

Plain Vite. **No SvelteKit.** Vite compiles *only* `.svelte` and `.svelte.js` files under `app/svelte/` into one fixed-name ESM chunk at `app/build/islands.js`. All 53 vanilla modules under `app/js/` keep being served verbatim as native ES modules. **`app/index.html` is never a build input and is never rewritten.**

That last sentence is the whole design. It is what makes `serve.py` need zero changes for the migration itself, and it structurally eliminates the highest-probability silent failure available to this project: `DocHandler.csp = build_csp(auth)` runs exactly once at `serve.py:1476`, and `_inline_script_hashes` (`serve.py:178`, called from `build_csp` at `serve.py:1517`) reads `app/index.html` off disk at that moment. If a build ever rewrote that file while the server was running, every response would carry a sha256 for a script the browser is not receiving.

**What "index.html is byte-identical" does and does not buy.** It guarantees the shell's own ids and the inline theme script survive. It does **not** guarantee "every mount target already exists", because two of them do not: `#covOverlay` is built at runtime by `coverage-view.js:58` and `#graphOverlay` by `map-view.js:233`, both appended to `document.body` during `boot()` — by the very modules Phases 6 and 7 replace. Those two overlays are handled explicitly in §6.4 and §6.5 and are the reason Phase 2 must migrate the overlay contract before anything else touches them. The selector contract survives by *transcription discipline* (§6.1), not by construction, on those two surfaces.

### The seam

`app/js/islands.js` — a new two-line plain vanilla module:

```js
// The single seam between the native-ESM world and the compiled Svelte world.
export * from '/build/islands.js';
```

Vanilla modules import mount functions from this shim, never from `/build/islands.js` directly. Reverting any surface is: restore the old vanilla module, change one import line, restore the previously committed `app/build/islands.js` from git (**not** `npm run build` — see §5's revert note).

**`app/svelte/entry.js`'s export surface is defined, not discovered.** It exports one named `mountX(target, props)` function per island plus a matching `unmountX(handle)`, and nothing else — no default export, no re-export of components, no `mountIsland` dispatcher. The list grows one line per phase:

```js
// app/svelte/entry.js — the only module Vite treats as an entry. Every export
// is a mount/unmount pair. Adding an island = adding two lines here.
export { mountDocTree, unmountDocTree, mountSearchHits, unmountSearchHits } from './islands/tree.js';   // Phase 3
export { mountToc, unmountToc, mountCrumbs, unmountCrumbs, mountFootGroup, unmountFootGroup } from './islands/reader.js';  // Phase 4
// … Phases 5, 6, 7
```

The Phase 1 no-op island proves the shape with a single `mountNoOp`/`unmountNoOp` pair, and the build test asserts both names are present in the emitted file — the same assertion that catches Rolldown tree-shaking the exports away.

### Component tree (end state, after Phase 7)

Mount targets are named exactly. Where a target is created at runtime it says so.

```
(no root component — app/js/main.js stays a vanilla awaited boot function)
│
├── #doc-tree  … the drawer element itself stays VANILLA (main.js setupDrawer:
│   │            open/close, focus capture + restore, scrim, Escape, overflow lock)
│   ├── .drawer-head / .drawer-title / #drawerClose  … VANILLA (main.js:113)
│   ├── #treeSearch                                  … VANILLA (main.js setupDrawerSearch)
│   ├── DocTree          mounted into #treeList        [Phase 3]
│   │   └── TreeFolder (recursive, SELF-IMPORT not <svelte:self>)
│   │       └── DocLink   (renders the lock affordance from icons.js + auth.css)
│   └── SearchHitList    mounted into #searchResults   [Phase 3]
│       └── SearchHit
│
├── #toc / .toc-cap  … VANILLA. Nothing references el('toc') today, so the
│   │                  "On this page" caption is permanently visible even with an
│   │                  empty TOC. Phase 4 gives it an owner: reader.js sets
│   │                  el('toc').hidden = entries.length === 0. Deliberate fix.
│   └── Toc              mounted into #tocList         [Phase 4]
├── Crumbs               mounted into #crumbs          [Phase 4]
├── FootGroup            mounted into #footPrev  }  TWO mounts, not one — mount()
├── FootGroup            mounted into #footNext  }  takes exactly one target and
│                                                   .app-footer has no id.
│                                                   Their `hidden` stays vanilla.
├── #live  … VANILLA. announce() in a plain module writes it. No component.
├── #brand, #docSearch, #hamburger, #themeBtn … VANILLA, untouched.
│
├── AccountPanel / AdminPanel / CreateUserDialog  (inside Modal)   [Phase 5]
│   └── UserRow
├── AccountButton        mounted into #accountBtn      [Phase 5]
│                        (#accountBtn.hidden stays written by auth-ui.js:150)
├── SignInWall           mounted into document.body    [Phase 5]  NOT a Modal
├── Modal                shared shell — deliberately NOT used by SignInWall
├── GroupChip            + groupChip() DOM adapter, name unchanged
├── RestrictedPage       mounted into #content by the router error branch
├── RestrictedSection    mounted by reader.js's post-render pass
│
├── CoverageOverlay      mounted into #covOverlay      [Phase 6]
│   │                    — created at runtime; Phase 2 moves its creation out of
│   │                      setupCoverageView() into boot so the id exists eagerly
│   ├── CovLegend
│   ├── CovExportButton  (.cov-export-btn → exportReport() → downloadFile())
│   ├── ReportPanel
│   │   ├── VerifyingTests
│   │   ├── AutomatedTests
│   │   └── StepReport
│   └── (graph canvas — use:graph action, NOT a component)
├── RunnerOverlay                                      [Phase 6]
│   ├── RunTest
│   │   └── PassFail
│   └── (richText fields — use:richtext action, NOT components)
├── ReqTable / TestCase  mounted into .wd-mounted hosts inside the article [Phase 6]
│
└── MapOverlay           mounted into #graphOverlay    [Phase 7]
    │                    — created at runtime; Phase 2 moves its creation too
    ├── MapToolbar, MapSearch, EdgeLegend, MapModeSelect,
    │   GroupLegend, EditControls, MapEmpty
    └── GraphCanvas — <canvas bind:this>, controller in onMount, NOT declarative
```

**`<svelte:self>` is deprecated in Svelte 5** — compiling it emits `svelte_self_deprecated` on every build, which with eslint and `svelte-check` in CI is permanent noise. `TreeFolder.svelte` imports itself by path instead.

### State design (Svelte 5 runes)

`app/js/app-shell.js` is **not deleted**. Its mutable `state` object and the `app` service registry stay for every unported surface, and they retire surface by surface.

**Three rules that make this work, all of them consequences of §0.8:**

1. Every rune store lives under `app/svelte/stores/` and is compiled. No `.svelte.js` under `app/js/`.
2. Every vanilla module that a store needs to observe grows a **plain listener array** — the same pattern `auth.js` already uses with `onAuthChange`. The store subscribes; the vanilla module knows nothing about Svelte.
3. **Never export a reassigned `$state` binding.** Svelte 5 rejects it outright (`state_invalid_export`: "Cannot export state from a module if it is reassigned"). Export an object whose *properties* are mutated, or export getter/setter functions. `export let activeDocId = $state('')` is a hard compile error, not a style preference.

**`app/js/app-shell.js` gains a plain emitter** (~10 lines), because `state` is a plain object and `state.byId` a plain `Map`, so reading `state.current` from a component creates no dependency:

```js
const stateListeners = [];
export function onStateChange(fn) { stateListeners.push(fn); return () => { const i = stateListeners.indexOf(fn); if (i >= 0) stateListeners.splice(i, 1); }; }
export function notifyState(what) { for (const fn of stateListeners.slice()) { try { fn(what); } catch (e) {} } }
```

`reader.js` calls `notifyState('current')` where it assigns `state.current`. `app/svelte/stores/shell.svelte.js` mirrors:

```js
import { state, onStateChange } from '/js/app-shell.js';
export const shell = $state({ currentId: '', currentTitle: '', rev: 0 });
onStateChange(() => {
  shell.currentId = state.current ? state.current.id : '';
  shell.currentTitle = state.current ? state.current.title : '';
  shell.rev = state.current ? (state.current._rev || 0) : 0;
});
```

`Toc`, `Crumbs` and `FootGroup` read `shell`, never `state`. **Mutable `Doc` objects are never read directly from a component** — `catalog.loadDoc` mutates them in place and no proxy sees it.

**`app/svelte/stores/tree.svelte.js`** (Phase 3) — replaces `tree.js`'s module-global `onSelectCb` and the `details._load` DOM expando. Note both fixes: an exported object rather than exported bare bindings, and `SvelteSet` rather than a plain `Set`, because `$state` proxies only plain objects and arrays — `expandedPaths.add(...)` on a raw `Set` notifies nothing and the tree never repaints.

```js
import { SvelteSet } from 'svelte/reactivity';

const levels = new Map();                       // path -> {folders, docs} | Promise  (NOT reactive, deliberately)
export const tree = $state({ activeDocId: '', expanded: new SvelteSet() });

export function loadLevel(path) { /* memoised on levels */ }
export async function expandTo(id) { /* awaits each ancestor level, then tree.expanded.add(path) */ }
export function setActive(id) { tree.activeDocId = id; }     // property write, not a rebinding
export function invalidate() { levels.clear(); /* KEEP tree.expanded */ }
```

`invalidate()` deliberately keeps the expansion set. Today `renderTree()` wipes and refetches from the root on create (`authoring.js:123`), on delete (`authoring.js:296`) and on every 4s external-change poll (`main.js:346`), collapsing the reader's tree each time. (It does **not** rebuild on an ordinary save — `authoring.js:226` is `if (wasNew) await rerenderTree();`, so saving an existing document already leaves the tree alone. The manual verification step for this change must therefore be "create a document", not "save one".) Keeping expansion across the other three paths is an improvement, and therefore a deliberate behaviour change whose e2e assertion is updated on purpose.

`markActive` and its private `cssEscape` shim are deleted; `aria-current` is derived from `tree.activeDocId`, ancestor expansion becomes `expandTo()`, and the `scrollIntoView({block:'nearest'})` is reproduced explicitly (§0.6).

**`app/svelte/stores/auth.svelte.js`** (Phase 5) — a thin adapter, *not* a rewrite. `app/js/auth.js` (366 lines) stays untouched. Nine modules read its mutable `auth` object directly and most are not ported in the same pass:

```js
import { auth, onAuthChange } from '/js/auth.js';
export const authState = $state({ ...auth });
onAuthChange(() => Object.assign(authState, auth));
```

**`app/svelte/stores/ui.svelte.js`** (Phase 2 onward) — `mapOpen`, `coverageOpen`, `runnerOpen`, and a **refcounted `scrollLock`**. `drawerOpen` is *not* here: `setupDrawer` stays vanilla and keeps sole ownership of `#doc-tree.hidden`, `#scrim.hidden`, `#hamburger[aria-expanded]`, `documentElement.style.overflow` and the focus restore. One writer, and it is the one that already exists.

`mapOpen`/`coverageOpen` land in **Phase 2**, before the dynamic-import split, and are mirrored by a plain `app/js/overlays.js` so `authoring.js` and `main.js` can read them without importing anything compiled:

```js
// app/js/overlays.js — plain module, no runes. The single source of truth for
// "is the map / coverage overlay open", replacing el('graphOverlay').hidden.
let mapIsOpen = false, coverageIsOpen = false;
const listeners = [];
export const mapOpen = () => mapIsOpen;
export const coverageOpen = () => coverageIsOpen;
export function setMapOpen(v) { mapIsOpen = !!v; notify(); }
export function requestMapRebuild() { if (mapIsOpen) rebuildCb && rebuildCb(); }
```

`ui.svelte.js` subscribes to it. That inversion is what makes the Phase 2 lazy-import split safe (§5, Phase 2).

**`coverageStatus`** (Phase 6) — the one genuinely valuable reactive conversion. `statusOf()` is read at table-*build* time (`requirements/render.js:73,76`), which is why `main.js:245-247` currently does `setCoverageStatus` followed by a whole-document `renderDoc` after a runner save. `requirements/store.js` (40 lines) **keeps its name and stays vanilla**, gaining a five-line listener array; `app/svelte/stores/coverage.svelte.js` mirrors just the status map plus a version counter. `index`, `testIndex` and `groupsByDoc` stay plain `Map`s behind that single counter — they are replaced wholesale by `buildRequirementIndex()`, so per-key reactivity buys nothing and would proxy thousands of entries.

### The hard boundary

**Svelte owns:** elements it created, inside a mount target, that nothing else writes to.

**A plain module owns — permanently, by design — approximately 4,550 lines:**

| what | files | why |
|---|---|---|
| CommonMark parser | `app/js/commonmark.js` + `app/js/md/*.js` (1,827 lines) | Provably DOM-free. Grepped for `document`/`window`/`DOMParser`/`innerHTML`/`createElement`/`querySelector`/`localStorage`/`fetch` across `app/js/md/*` — zero hits. Nothing to gain. |
| sanitizer | `app/js/sanitize.js` (149) | Security boundary. Must keep returning a `DocumentFragment` that is *appended*, never stringified. |
| highlighter | `app/js/highlighter.js` + `app/js/highlight/*.js` (661) | `rebuild()` does `code.textContent = ''` then re-appends spans — it destroys any children under it. |
| block renderer registry | `app/js/blocks.js` (186) | Runs after the sanitizer as a decoration stage, performs its own defensive scrub of plugin output, and must keep building trusted DOM directly. |
| canvas graph engine | `graph/render.js` (777), `view.js` (174), `layout.js` (590), the canvas half of `interactions.js` | There is no per-node DOM to diff. The whole design premise is that there isn't any. |
| contenteditable | `app/js/editor/richtext.js` (374) and the four editable region kinds | See §6.7. |

**The rendered article subtree is territory Svelte enters at exactly two host elements, under a written contract.** `reader.js:33` does `content.textContent = ''` then appends one `<article class="doc">` built from a `DocumentFragment`, which is then mutated in place by eleven passes: lede insertion, `numberHeadings`, `renderRequirements` (`pre.replaceWith`), `resolveLinks` (async, rewrites `a[href]`), `resolveImages`, `renderBlocks` (`pre.replaceWith`, async for mermaid), `renderRestrictedSections` (`pre.replaceWith`), `highlightWithin` (`code.textContent=''`), scroll-spy, `reveal()` from `main.js:179-181`, and the find-in-page pass, which TreeWalks text nodes, wraps matches in `<mark class="find">` via `text.replaceWith(frag)` (`reader.js:298-317`) and calls **`root.normalize()` over the whole article** on every keystroke (`reader.js:288`).

This is not a theoretical hazard. Svelte 5's `mount()` appends an **empty text node** as its block anchor, and `normalize()` removes empty text nodes outright — not merely coalescing them. Two characters typed into `#docSearch` on a document with a requirement table would detach the nodes those components hold.

**The contract, landed in Phase 4 before anything is mounted inside the article (§5):**

1. Every Svelte host inside the article carries `class="wd-mounted"` (styled `display: contents` in `requirements.css`).
2. `clearHighlights` (`reader.js:286-289`) stops calling `root.normalize()` over the whole article and normalizes only the specific parent nodes it un-wrapped.
3. The find-in-page TreeWalker's rejection list grows from `pre, code, mark` to `pre, code, mark, .wd-mounted` — so `text.replaceWith(frag)` never runs inside a mounted subtree.
4. `resolveLinks` and `resolveImages` scope their `querySelectorAll` with `:not(.wd-mounted *)`; components render their own links, and a component's link is its own to rewrite.
5. `highlightWithin` already scopes to `pre > code`, which no component emits; a `.wd-mounted` exclusion is added anyway as belt-and-braces.

Points 2-5 are five lines of `reader.js` and they are the difference between Phase 6 shipping and Phase 6 being a slow-motion corruption bug. They land in Phase 4, with a Playwright test that types into `#docSearch` on a document containing a fenced requirement block, so the guard exists before the first mount.

**`{@html}` is banned project-wide, enforced by lint, not convention.** `app/js/md/render.js:87` (`case 'htmlblock': return b.lines.join('\n')`) and `app/js/md/inline.js:207` (`push({kind:'raw', html: mm[0]})`) pass author HTML through **unescaped by design**. `sanitize.js` is the only gate. `{@html}` performs no sanitization and takes a *string*, which would force a fragment→string→fragment round trip — the classic mXSS bypass class. There are **eight** `sanitizeToFragment` call sites (`reader.js:36`, `requirements/render.js:27` and `:36`, `report.js:33` and `:38`, `coverage-report.js:36`, `runner.js:68`, `editor/serialize.js:338`), so a per-file habit is not enough.

---

## 3. Toolchain

Every version below is an `npm view` result, and the config was **built and run** on this machine (node v24.15.0, npm 11.12.1) before being written down.

### `package.json` (repo root)

```json
{
  "name": "webdoc-ui",
  "private": true,
  "type": "module",
  "engines": { "node": "^20.19 || ^22.12 || >=24" },
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "test": "vitest run",
    "check": "svelte-check --tsconfig ./jsconfig.json",
    "lint": "eslint app/svelte"
  },
  "dependencies": {},
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "7.3.0",
    "svelte": "5.56.10",
    "vite": "8.2.2",
    "svelte-check": "4.7.6",
    "eslint": "10.9.0",
    "eslint-plugin-svelte": "3.23.0",
    "prettier": "3.9.6",
    "prettier-plugin-svelte": "4.1.1",
    "vitest": "4.1.11",
    "@testing-library/svelte": "5.4.2",
    "jsdom": "30.0.1"
  }
}
```

`"dependencies": {}` is empty and stays empty forever. That empty object is the machine-checkable form of `sys_10`. Svelte is a devDependency because it is *compiled in* — nothing resolves the specifier `svelte` at run time. The `test` script exists because §7 specifies component tests; without it, `vitest` would be installed and unreachable.

Exact pins, no carets, and **commit `package-lock.json`** — the build output is committed, so the build must be reproducible.

Peer ranges verified: `@sveltejs/vite-plugin-svelte@7.3.0` declares peers `vite ^8.0.0-beta.7 || ^8.0.0` and `svelte ^5.46.4`; `svelte@5.56.10` and `vite@8.2.2` are both `latest`. Engine intersection is `^20.19 || ^22.12 || >=24`.

### `vite.config.js`

```js
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// THE LOAD-BEARING PLUGIN OF THE WHOLE STRATEGY.
// Any import of an existing app module is left as a bare ESM specifier so the
// BROWSER resolves it natively at run time against the same file main.js loads.
// One module instance, one copy of its state. Bundling a copy would fork it.
// This is also what makes `import { closeIcon } from "/js/icons.js"` inside a
// component safe: it stays external, so there is no second icons module.
const keepNative = {
  name: 'webdoc-keep-native-esm',
  enforce: 'pre',
  resolveId(id) {
    if (id.startsWith('/js/')) return { id, external: true };
    if (/^\.\.?\//.test(id) && /\/app\/js\//.test(id)) {
      this.error(`Import "${id}" must be written as an absolute "/js/..." specifier.`);
    }
    return null;
  },
};

export default defineConfig({
  plugins: [keepNative, svelte({ emitCss: false })],
  build: {
    outDir: 'app/build',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    minify: 'oxc',
    lib: { entry: 'app/svelte/entry.js', formats: ['es'], fileName: () => 'islands.js' },
    rollupOptions: {
      output: { codeSplitting: false },
      // Tripwire. app/thirdpartyrenderer is never a build input under this
      // strategy, so this is belt-and-braces against someone breaking that rule.
      external: [/app\/thirdpartyrenderer\//],
    },
  },
});
```

Three facts discovered by building rather than by reading docs:

1. Vite 8 is Rolldown-based and `minify: 'esbuild'` **fails outright** — esbuild is no longer bundled. Use `minify: 'oxc'`.
2. `output.inlineDynamicImports` is deprecated in favour of `output.codeSplitting: false`.
3. `build.lib` is **required, not cosmetic**. A first attempt using `rollupOptions.input` had Rolldown tree-shake every export away, emitting a 679-byte file with no exports at all. `lib` mode sets the entry signature correctly.

Verified output properties: `from "/js/app-shell.js"` and `from "/js/dom.js"` survive verbatim as external imports; zero `eval(` or `new Function(`; zero `import.meta`; exactly one emitted file (no CSS sidecar, no sourcemap, no split chunks).

### Other config files

- `svelte.config.js` — `{ compilerOptions: { runes: true } }`. Runes-only, so legacy reactivity cannot drift in.
- `jsconfig.json` — `checkJs: true` over the existing JSDoc, for `svelte-check`.
- `eslint.config.js` — flat config with `eslint-plugin-svelte`, `svelte/no-at-html-tags: "error"` with no per-file disables permitted, `no-restricted-imports` forbidding relative imports that reach into `app/js/`, and a path rule rejecting any `.svelte`/`.svelte.js` file outside `app/svelte/`.
- `.gitattributes`:

  ```
  # The committed browser bundle. Machine-generated: never merge it textually,
  # always rebuild. LF-normalised and binary-diffed so core.autocrlf (true on at
  # least one dev machine) cannot make a byte-identical rebuild look dirty.
  app/build/islands.js  -diff -merge -text eol=lf linguist-generated=true
  ```

  The `-text eol=lf` half is not decorative: `git config core.autocrlf` returns `true` here and there is no `.gitattributes` in the repo today, so without it Phase 1's `git diff --exit-code -- app/build/` gate would fail on line-ending churn alone.

### Gitignored vs committed

**Added to `.gitignore`:** `node_modules/`, `.vite/`, `*.tsbuildinfo`. **Kept:** `app/thirdpartyrenderer/*.min.js` (line 7), `.webdoc-index/` (line 8), `.webdoc-auth/` (line 14). The comment block at `.gitignore:1-6` is corrected in the same commit (§8).

**Committed:** `package.json`, `package-lock.json`, `vite.config.js`, `svelte.config.js`, `jsconfig.json`, `eslint.config.js`, `app/svelte/**`, and — deliberately — **`app/build/islands.js`**.

`app/build/` contains exactly one file and nothing else, ever. No sourcemaps: `route()` serves everything under `APP_DIR` **before any ACL check** (`serve.py:1036-1041`), so a `.map` there would be world-readable to a signed-out visitor on an accounts-enabled server.

Committing a build artifact is genuinely unpleasant and there is no clever way out. `.gitattributes -diff` keeps it out of review, `-merge` forces the conflict to be loud (the correct resolution is **always** "take either side, then rebuild"), and the Phase-1 freshness gate catches staleness. The alternative — gitignoring the build — converts a Python-only project into a Node-required one, which is a strictly *larger* constraint change than the 10 kB runtime.

### The answer for a contributor with no Node

| you are editing | do you need Node? |
|---|---|
| Markdown, CSS, Python, or any of the 53 vanilla modules under `app/js/` | **No.** Edit, refresh. Exactly as today. |
| a `.svelte` or `.svelte.js` file under `app/svelte/` | Yes — Node `^20.19 \|\| ^22.12 \|\| >=24`, then `npm ci`. |
| reviewing a PR | No. You see the `.svelte` diff plus one opaque blob that `.gitattributes` collapses to a single line. |
| **reverting a UI change during an incident** | **No — but only if you follow §5's revert procedure**, which restores the previously committed `app/build/islands.js` from git rather than rebuilding. `git revert <sha>` does exactly that in one command, because the bundle is part of the commit. Never write "rebuild" in a rollback instruction. |

And for anyone who only wants to *run* WebDocs: `git clone && python serve.py` on a machine with no Node, no npm and no network works, with the same feature set a clean clone has today — which excludes mermaid rendering until the bring-your-own library is dropped in (§1). There is no "run npm install first" step, no postinstall, no build precondition on starting the server.

---

## 4. Server changes

### For the migration itself: zero

Every part of this was verified against the source.

- **`APP_DIR`** (`serve.py:39`) stays `os.path.join(HERE, "app")`. All four uses keep their current meaning: the definition, the auth-overlap guard (`serve.py:113/116`), the static serve (`serve.py:1038`), and the CSP hash source (`serve.py:1517`).
- **Static serve**: `route()` at `serve.py:1038` does `safe_join(APP_DIR, path.lstrip("/"))`. `GET /build/islands.js` resolves to `app/build/islands.js` and `_file()` serves it.
- **Content type**: `.js` is already explicit in `CONTENT_TYPES` (`serve.py:57`). Nothing to add.
- **`.svelte` sources are fetchable and have no `CONTENT_TYPES` entry.** `content_type()` (`serve.py:74-76`) falls back to `mimetypes.guess_type` and then `application/octet-stream`, and `_emit_headers` sends `X-Content-Type-Options: nosniff` on every response (`serve.py:283`), so the browser will download rather than execute or render them. The exposure is "the source of code that is already in the shipped bundle is readable", which is the same exposure the 53 `app/js` modules already have. Accept it knowingly rather than calling it negligible without checking.
- **SPA / history fallback**: not needed. Hash routing is kept.
- **CSP**: untouched, and cannot go stale, because the build never opens `index.html`. No new `<script>` tag is added — the bundle is loaded by a static `import` from inside the existing module graph, which `script-src 'self'` already permits.
- **Dev proxy**: none, because there is no dev server.

### Two changes that are worth making anyway — as separately-labelled commits

**S1 — gzip on the static path (Phase 2, its own commit).** `_file` (`serve.py:855-861`) does a bare read-and-send; `_json` (`serve.py:316-325`) already has the whole gzip branch. Extend it to `_file` for text types. The app ships 563,149 verified bytes of uncompressed JavaScript on every cold load with `Cache-Control: no-store` stamped on every response by `_emit_headers` (`serve.py:293`).

**S2 — CSP self-consistency test (Phase 1).** Not a `serve.py` edit. See §7, including the two branches that make the header absent or operator-supplied.

### Explicitly out of scope

Path-scoped `immutable` caching. The bundle has a fixed filename with no content hash, so there is nothing to cache-bust — and no possibility of a stale hashed asset outliving a permission change. With accounts enabled that is a security property.

---

## 5. Migration phases

Each phase is one PR, independently shippable, independently revertable, and leaves the app fully working.

**The revert procedure, stated once and identical for every phase from 3 onward:** `git revert <sha>`. That single command restores the vanilla modules, the import lines **and** the previously committed `app/build/islands.js` in one operation, because all three are in the same commit. **Never `npm run build` as part of a rollback** — that would make an incident rollback require Node on the operator's machine, contradicting `sys_9`/`sys_11`. Each phase below names the call sites a revert must restore, so a partial hand-revert is possible if a full revert is not wanted.

---

### Phase 0 — Green baseline (no Node, no Svelte)

**Goal.** A genuinely green test suite, so that every later failure is attributable.

**Files touched.**
- `tests/conftest.py:23` — `APP_DIR = "C:/Users/panda/Web_Doc/app"` is a hard-coded absolute literal. Derive it from `__file__`. **And make the fallback start `serve.py` rather than `python -m http.server`.**
- **`app/dev/*.html` — extract every inline script to an external file.** This is the prerequisite the previous draft omitted, and without it Phase 0's two exit criteria are mutually exclusive. `_inline_script_hashes` (`serve.py:178`) hashes **only** `app/index.html`, and `securityHeaders` defaults to `True` (`webdoc_auth.py:633`), so under the real server every inline script in `app/dev/` is CSP-blocked. All four harnesses carry one: `conformance-full.html` (`:9` plain, `:102-272` module), `conformance.html` (`:9` plain, `:89-210` module importing `renderMarkdown, INTERIM`), `graph-demo.html` (`:53-95` module importing `createGraph`), `highlight-demo.html` (`:155-168` module importing `highlightWithin`). Move each to a sibling `.js` and load it with `<script src="…">` / `<script type="module" src="…">`. That is the only fix that needs no `serve.py` change and no widening of `_inline_script_hashes`, and it makes `tests/test_conformance.py` pass under the real CSP instead of passing only because the fallback sends no policy at all.
- **`tests/test_e2e.py:26-34` — author the fixture corpus, do not just repoint it.** `DOC_IDS`/`DEFAULT_DOC` target a source named `Guides` with 8 documents; `config.json` mounts one source, `Docs` → `docs/`, and `find . -iname '*guides*'` returns nothing. Repointing at `docs/` covers most tests, but **two do not have a fixture at all**: `test_sanitizer_neutralizes_xss` needs a document containing live XSS payloads (`Guides/security-and-html`), and the `.foot-missing` test at `:255` already self-skips for lack of one. Adding an XSS-demo page to the product's own published documentation is a content decision, not hygiene — decide it explicitly. The recommended answer is a **separate fixture source**: a `tests/fixtures/` folder mounted as a second source in a test-only `config.json`, so the suite gets its payload documents and dangling links without publishing them. Budgeted separately in §10.
- `tests/test_e2e.py:15` and `tests/README.md:94` — both document a `#reqBtn` that no longer exists in `app/index.html`. Delete the references.
- `tests/test_e2e.py:123` and `:147` — the two drawer tests appear to assert a fully-expanded tree that `renderTree` does not produce. **(unverified: whether they fail for that reason — run them first, then fix.)**
- **`tests/test_e2e.py:262-275` — delete the `.foot-missing` assertions.** Grepping `app/` and `docs/` for `foot-missing` returns **zero** hits; `buildFootGroup` (`reader.js:224-237`) always emits an `<a>`, and its own comment at `:228-230` explains that lazy boot removed the existence check. The class is dead. Do not carry a dead contract into Phase 4's exit criteria.
- `app/js/main.js:429` — `boot()` is called unawaited with no `.catch`. Any rejection leaves `body[data-app-ready]="0"` forever and every Playwright test times out with no diagnostic. Add a top-level `.catch` that calls `showError`.
- `app/js/main.js` (boot) — add an id assertion over the 22 template ids that `el()` resolves, throwing a **named** error if any is missing.
- `app/js/catalog.js:58-110` — delete the dead `discover`/`walk`/`makeDoc` (~53 lines). Grepping for `discover` outside this file returns only `main.js:400`'s comment saying not to use it. `makeDoc` duplicates `app-shell.docFromId`.

**Exit criteria.** `pytest tests/` fully green against a real `serve.py` started by conftest, with the real CSP applied — including `tests/test_conformance.py` clearing `BASELINE_PASS_RATE 0.55`, which is now reachable because the harness scripts are external.

**Verify.** All 14 tests in `tests/test_e2e.py`; `tests/test_conformance.py`; `tests/test_access_control.py` (1,073 lines) unmodified. Manually load all four `app/dev/*.html` harnesses under `serve.py` and confirm each still runs.

**Revert.** `git revert`. Note this is **not** purely test and dead-code changes: it also edits `app/js/main.js` (top-level `.catch`, id-assertion loop), rewrites four `app/dev/*.html` files, and removes an exported symbol from `app/js/catalog.js` (`discover` is an `export` at `catalog.js:64` — removing an export is an API change, even though nothing in `app/`, `app/dev/` or `tools/` imports it).

---

### Phase 1 — Toolchain proof (Node, still no Svelte behaviour)

**Goal.** Prove the build workflow *independently of the framework*. If this commit is green, every remaining risk is framework risk; if it is red, nothing has been written.

**Files touched.** New: `package.json`, `package-lock.json`, `vite.config.js`, `svelte.config.js`, `jsconfig.json`, `eslint.config.js`, `.gitattributes`, `vitest.config.js`. Modified: `.gitignore` (entries **and** the comment block at `:1-6`). New: `app/svelte/entry.js` and `app/svelte/NoOp.svelte` — a **no-op island that nothing imports**. New: `app/build/islands.js`, committed. New: `app/js/islands.js` (the shim). New: `tests/test_build_current.py`, `tests/test_build_externals.py`, `tests/test_csp_self_consistency.py`.

**Documentation that lands in this commit, not Phase 8.** `tests/README.md:7-10` ("There is no Node.js, no npm, no `package.json` anywhere"), `tests/README.md:10` ("two additional harness files" → four), `tests/README.md:51`, the comment block in `tests/requirements-dev.txt`, and `.gitignore:1-6`. §1 requires these in the *same commit* as `package.json`; scheduling them into Phase 8 would ship seven phases of a repository whose own test README denies the existence of the `package.json` sitting next to it.

**Exit criteria — split across two CI jobs, because their network requirements are incompatible.**

*Job A (networked, or warm npm cache):*
- `npm ci && npm run build` produces `app/build/islands.js` byte-identically on a second run.
- `npm ci && npm run build && git diff --exit-code -- app/build/` (freshness gate).
- `npm test` runs (zero component tests so far) and `npm run check` and `npm run lint` pass.

*Job B (`sys_9` gate — a container with no `node` binary, no `node_modules`, no network):*
- Fresh clone, `python serve.py`, **poll `/api/index/status` until the cold SQLite index build completes** (with an explicit timeout and a clear failure message — a fresh clone has no `.webdoc-index/`, and until the build finishes every `/api/index/*` answers 503, per `serve.py:492`), then run the HTTP suite and assert `body[data-app-ready="1"]`.
- The full Python suite passes **unchanged**, including `tests/test_access_control.py:747`'s `assert c.get("/js/main.js").status == 200` — which stays true, because `main.js` is still a real served file at that exact path.

Nothing in Job B runs `npm`. Nothing in Job A needs a Node-free image. Describing them as one phase's exit criteria without separating them, as the previous draft did, produces a gate that cannot be built.

**Revert.** `git revert` removes the toolchain entirely. Nothing in `app/js/` (beyond the unimported shim) or `app/index.html` was touched.

---

### Phase 2 — Performance, overlay contract, and hygiene (no Svelte)

**Goal.** Land the wins that have nothing to do with Svelte, and land the overlay contract that Phases 6 and 7 depend on — *before* the lazy-import split that would otherwise break authoring.

**This phase is a real refactor, not a one-file change.** The eager import graph is held by three files the previous draft did not touch:
- `app/js/app-shell.js:6` statically imports `computeCoverage`/`computeTestStatus` from `./coverage.js`, and `app-shell.js` is imported by `main.js`, `reader.js`, `authoring.js`, `map-view.js` and `coverage-view.js`. Move those two functions' *call sites* out of `app-shell.js` (`combinedStatus` becomes a thin injectable) so `app-shell.js` no longer pulls the 445-line coverage engine into every module.
- `app/js/authoring.js:9-10` statically imports `./editor.js` and `./map-view.js` (which imports `./graph.js`). Both become dynamic imports inside the handlers that need them.
- `main.js:408` calls `setLinkSearch` (from `editor.js`) and `main.js:411-414` calls `loadResults` (from `coverage.js`) unconditionally during `boot()`. `setLinkSearch` moves to the point the editor is first opened. `loadResults` **stays eager** — deferring it would leave requirement badges uncoloured at first paint, which is a visible behaviour change — but it is imported from a new 40-line `app/js/coverage-load.js` that does not drag in the report generator or the overlay.

**Files touched, in commit order.**

1. **`app/js/overlays.js` (new) + the contract migration. Its own commit, and it must come first.** `authoring.js:93`, `:125`, `:304` dereference `el('graphOverlay').hidden` unconditionally, and `#graphOverlay` is created by `setupGraphButton()` → `map-view.js:233` during boot. The moment `map-view.js` is lazy-loaded, `el('graphOverlay')` is `null` until the button is first pressed, and the first document create, delete or edit throws a `TypeError`. Replace all four sites (`authoring.js:93/:125/:304` and `main.js:354-355`) with `mapOpen()` / `requestMapRebuild()`. Same for `coverageOpen()`. Move the *creation* of `#graphOverlay` and `#covOverlay` out of `setupGraphButton()`/`setupCoverageView()` into a tiny eager `ensureOverlayHosts()` called from `boot()`, so both ids exist from first paint regardless of when their modules load — which is also what makes them valid mount targets in Phases 6 and 7 without ordering either phase against `boot()`.
2. **`serve.py` `_file` gzip** (change S1). Its own commit.
3. **Dynamic `import()` split** across `main.js`, `app-shell.js`, `authoring.js`, and the new `coverage-load.js`. Its own commit.
4. **`?req=` and `?test=` promoted** out of the middle of the hash string into real `location.search`. Deletes `reqFromQuery`/`testFromQuery`. Its own commit.

**Exit criteria.** Full suite green; first paint of a document no longer downloads `editor.js` or `graph.js`; requirement badges are still coloured at first paint; creating, saving and deleting a document with the map never opened does not throw.

**Verify.** `tests/test_e2e.py` in full. Manual: with DevTools Network open, confirm `editor.js` and `graph.js` are absent until their button is pressed. Manual: with the map never opened, create a document, save it, delete it — no console error. Manual: with the map open, create a document and confirm it appears in the map. Manual: a `?req=` deep link still reveals and flashes the right row.

**Revert.** Four independent reverts, innermost last.

---

### Phase 3 — First island: tree and search results

**Goal.** The smallest self-contained island. It proves the three things the whole uplift must prove — a rune store replacing a module global, a keyed `{#each}` replacing hand-rolled DOM, and the `/js/icons.js` seam — with no canvas, no contenteditable and no sanitizer.

**Scope, stated narrowly.** `setupDrawer` **stays vanilla in `main.js`**: `#doc-tree.hidden`, `#scrim.hidden`, `#hamburger[aria-expanded]`, `documentElement.style.overflow`, the Escape handler, the `#drawerClose` listener at `main.js:113`, and the `document.activeElement` capture / `lastFocus.focus()` restore at `main.js:98/100/110` are all untouched. Only `#treeList` and `#searchResults` get components; `main.js:130-131`'s `tree.hidden`/`results.hidden` toggle in `setupDrawerSearch` also stays vanilla, because those two elements are the mount *targets* and a mounted component cannot set an attribute on the element it was mounted into.

**Files touched.** New: `app/svelte/DocTree.svelte`, `TreeFolder.svelte`, `DocLink.svelte`, `SearchHitList.svelte`, `SearchHit.svelte`, `stores/tree.svelte.js`, `stores/ui.svelte.js`, `actions/icon.js`, `islands/tree.js`; `app/svelte/entry.js` gains four exports. Modified: `app/js/main.js` (**both** `renderTree` call sites — the boot call at `:416` *and* `main.js:346`'s call inside `onExternalChange`, fired by the 4-second generation poll; missing the second one means `tree.js:101`'s `container.textContent = ''` rips the mounted `DocTree` out with no teardown every four seconds), `app/js/tree.js` (reduced to the fetch helper; `renderTree`/`markActive`/`folderNode`/`docLink`/`cssEscape` deleted), `app/js/reader.js:83` (drop the `markActive` call; `setActive()` instead), `app/js/authoring.js:39-40` (`rerenderTree` → `invalidateTree()`), `app/css/app.css` (any new tree rule). Unchanged: `app/js/search.js` — all 44 lines import as-is, which is the proof that the server contract survives.

**Two cross-phase dependencies to satisfy here, not later.** `tree.js:9` imports `lockIcon` from `./icons.js` and renders server-supplied locked documents (`TreeDoc.locked`). `DocLink.svelte` must reproduce both the lock affordance — via `use:icon={lockIcon}`, importing from `/js/icons.js` — and the `.doc-lock` / `.is-locked` styling that lives in `app/css/auth.css`. Phase 5 owns `auth.css`; Phase 3 reads it. Add the ownership comment now so Phase 5's split does not move those selectors out from under the tree.

**Exit criteria.** Tree lazy-loads levels, active document is highlighted **and scrolled into view**, locked documents show the lock, search debounces at 200ms with the `AbortController` *and* the `seq` guard both retained (abort only rejects the fetch; an already-parsed response can still land late), expansion survives an external-change poll and a document create.

**Verify.** `tests/test_e2e.py` lines 107-153 — `#doc-tree`, `#scrim`, `#hamburger[aria-expanded]` rendering the literal string `"false"`, `#treeList a.doc-link` count, `#treeList a.doc-link[data-id='...']`. The expansion-preservation change requires deliberately updating the assertion at `:123`. New vitest tests for `TreeFolder` and `SearchHit`. Manual: open the drawer, expand a folder, **create** a document, confirm the folder stays expanded (creating, not saving — saving an existing document never rebuilt the tree). Manual: open the drawer, tab to an item, close with Escape, confirm focus returns to `#hamburger`. Manual: leave the app idle for two poll cycles with the drawer open and confirm the tree is still interactive.

**Revert.** `git revert`. A hand-revert must restore `tree.js`, re-add `markActive` at `reader.js:83`, and re-add `renderTree` at **both** `main.js:416` and `main.js:346`.

---

### Phase 4 — Reader satellites, and the article contract

**Goal.** TOC, footer, crumbs, live region — **and the mounted-subtree contract that Phase 6 depends on**, landed here, before anything is mounted inside the article.

**Files touched.** New: `app/svelte/Toc.svelte`, `Crumbs.svelte`, `FootGroup.svelte`, `stores/shell.svelte.js`, `islands/reader.js`. New: `app/js/announce.js` (a 6-line plain module owning `#live`). Modified: `app/js/reader.js` (satellites removed; the five article-contract changes below; the `teardownMounted(article)` registry), `app/js/numbering.js` (keep `numberHeadings`, delete `buildTOC` and its private `cssEscape`), `app/js/app-shell.js` (the `notifyState` emitter), `app/js/main.js` (×3 `el('live')` sites, `#toc` empty-state), `app/js/authoring.js` (×5 `el('live')` sites at `:120`, `:121`, `:124`, `:290`, `:297`), `app/js/coverage-view.js` (×2), `app/js/map-view.js` (×1) — 12 sites in total — and `app/css/app.css`.

**`#live` stays vanilla and gets a plain owner.** `announce(text)` writes `el('live').textContent`. No component, no store: `authoring.js` and `map-view.js` are vanilla and must be able to call it without importing anything compiled, and a live region whose contents are re-rendered by a framework is a well-known screen-reader hazard.

**The five article-contract changes to `reader.js`, landed with zero mounts inside the article:**
1. Every future Svelte host inside the article carries `class="wd-mounted"`; add the `display: contents` rule to `requirements.css` now.
2. `clearHighlights` (`:286-289`) stops calling `root.normalize()` over the whole article and normalizes only the parents it un-wrapped.
3. The find-in-page TreeWalker's rejection list grows from `pre, code, mark` to include `.wd-mounted`.
4. `resolveLinks` (`:143`) and `resolveImages` exclude `.wd-mounted` subtrees.
5. A `teardownMounted(article)` registry is added and called **before** `content.textContent = ''` at `reader.js:33`. It is a no-op this phase — and that is the point: the hook exists, is called on every one of `renderDoc`'s three trigger paths, and is covered by a test, before Phase 6 puts anything in it.

**The TOC needs `flushSync`, and this is the phase's easiest silent failure.** `reader.js:46-49` builds the TOC and `reader.js:80` calls `setupScrollSpy(article, tocList)`, which at `:249-250` synchronously reads `tocList.querySelectorAll('a[data-target]')` in the same tick. Svelte's prop-driven DOM updates are batched into a microtask, so without a `flushSync()` immediately after `mountToc(...)`, `links` is an empty `Map`, no TOC entry is ever marked `.active`, nothing throws, and no test covers it (`tests/test_e2e.py:176-194` checks only `#tocList a .n` text). `Toc.svelte` must also keep emitting `data-target` and the `<span class="n">` wrapper, and reproduce the click behaviour from §0.6.

Note that `spyObserver` needs no rework: `reader.js:248`, the first line of `setupScrollSpy`, is already `if (spyObserver) spyObserver.disconnect();`. There is exactly one observer and it is torn down before every rebuild.

`numberHeadings` already returns a clean `TocEntry[]` of `{level, number, text, id}` — that return value is the props boundary. Its DOM-mutating half stays, because it must stamp real `id` and `data-heading-number` attributes on the real headings inside the opaque article.

**Two mounts for the footer, not one.** `mount()` takes exactly one `target` and `<footer class="app-footer">` (`app/index.html:59`) has no id, so `FootGroup` is mounted twice — into `#footPrev` and `#footNext` — and their `hidden` attributes keep being written by vanilla `reader.js`.

**`body[data-app-ready="1"]` keeps its meaning.** `main.js:426` sets it after `route()` returns. From this phase on, the TOC, crumbs and footer are mounted by components, so `renderDoc` must `flushSync()` after its mounts before returning — which it already must do for scroll-spy. Six e2e assertions gate on that attribute; make the flush the reason they stay honest, and say so in a comment.

**Exit criteria.** Heading numbers still match the TOC exactly; clicking a TOC entry smooth-scrolls and focuses the heading; scroll-spy still marks `.active`; footer prev/next render with `#/<id>` hrefs; `#toc` hides when a document has no headings; typing two characters into `#docSearch` on a requirement-bearing document leaves the page intact.

**Verify.** `tests/test_e2e.py:176` (`data-heading-number` == `["1","1.1","1.1.1","1.1.2","1.1.3","1.2"]` and identical to `#tocList a .n`), `:234-239` and `:246-251` (footer hrefs). **New** Playwright tests: a TOC click focuses its heading; `.active` appears on scroll; `#docSearch` find-in-page over a requirement block leaves the article's node count unchanged.

**Revert.** `git revert`. A hand-revert must restore `buildTOC` at `reader.js:49`, `renderFooter`/`buildFootGroup`, and the 12 `el('live')` sites.

---

### Phase 5 — Auth screens

**Goal.** Sign-in wall, account button and panel, admin panel, create-user, group chips, restricted page and section.

**Files touched.** New: `app/svelte/SignInWall.svelte`, `AccountButton.svelte`, `AccountPanel.svelte`, `AdminPanel.svelte`, `UserRow.svelte`, `CreateUserDialog.svelte`, `Modal.svelte`, `GroupChip.svelte`, `RestrictedPage.svelte`, `RestrictedSection.svelte`, `stores/auth.svelte.js`, `islands/auth.js`. Modified: `app/js/auth-ui.js` (reduced to the `groupChip()` DOM adapter and the `#accountBtn.hidden` write at `:150`), `app/js/main.js:197-213` (`showRestricted`), `app/js/reader.js:104-111` (the restricted-section swap), `app/css/auth.css` (ownership comments). Unchanged: **`app/js/auth.js`, all 366 lines** — including its two DOM touches at `:220` (`document.cookie`) and `:294-296` (`getComputedStyle` for `--group-sat`/`--group-light`).

**`groupChip` keeps its name.** `editor/panels.js:7` and `editor/widgets.js:9` both `import { groupChip } from '../auth-ui.js'` and call it at `panels.js:66`/`:96` and `widgets.js:318`/`:331`. Renaming it to `groupChipEl` would edit two files that are permanently out of scope. The adapter must also **retain the instance handle**, because the editor rebuilds these chips on every access-panel render:

```js
// app/js/auth-ui.js — the DOM adapter the editor still calls. Returns the HOST,
// not host.firstElementChild: returning the child discards Svelte's anchor node
// and the instance handle, so the component could never be unmounted and would
// never update. The host is display:contents, so layout is unchanged.
const chipInstances = new WeakMap();
export function groupChip(name, opts) {
  const host = document.createElement('span');
  host.className = 'wd-mounted';
  chipInstances.set(host, mountGroupChip(host, { name, ...opts }));
  return host;
}
export function destroyGroupChip(host) {
  const inst = chipInstances.get(host);
  if (inst) { unmountGroupChip(inst); chipInstances.delete(host); }
}
```

Whoever clears a container full of chips calls `destroyGroupChip` on each first. That is one extra line in `panels.js`'s and `widgets.js`'s existing clear paths — **the only two lines this plan adds to `app/js/editor/**`**, and they are called out here so the non-goal is precise rather than aspirational.

**Four rules that are not optional:**

1. **Boot suspension survives.** `boot()` literally `await`s `showSignInWall()` before `waitForIndex`, `buildRequirementIndex`, `renderTree`, `route()` and `startChangeWatcher`. Keep that shape: `if (signInRequired()) { await new Promise(resolve => mountSignInWall(document.body, {onSignedIn: resolve})); await loadAuth(); }`. Do **not** render the router behind `{#if !signedIn}` — that fires library fetches from a locked-out browser. The server refuses them, so it is not a leak, but it converts "no request made" into "request made and denied", a regression against R_WD_ACC_11.
2. **The wall is not dismissible.** `.auth-wall` deliberately has no Escape handler and no scrim-click close, unlike the shared `modal()` which has both. Reusing one `Modal.svelte` for both would silently make the wall dismissible.
3. **The three `location.reload()` calls stay.** `state.byId` holds document body text that was redacted (or not) for the *previous* principal; `accessCache` has no TTL and is not cleared on sign-in/sign-out. Replacing the reload with a reactive store transition is a data leak unless it performs an explicit purge.
4. **Text-node-only rendering is the XSS control.** Usernames, display names, group labels and server error strings are attacker-chosen. Svelte's `{expr}` is equivalently safe; one `{@html}` here is a regression.

Also generate unique input ids — `authUser`/`authPass`/`authName`/`pwCurrent`/`pwNext`/`newUser`/`newPass`/`newName` are hard-coded literals today and already collide when the account panel and create-user dialog stack.

**`app/css/auth.css` is annotated, not split into files.** `:root --group-sat`/`--group-light`/`--locked-bg` stay in `:root` (`auth.js:294-296` reads them via `getComputedStyle`), and `.doc-lock`/`.is-locked`, `.graph-groups*` and `.access-*` stay global because they style DOM owned by the Phase 3 tree, `graph/chrome.js` and the editor.

**Exit criteria.** Sign-in, sign-out, password change, admin user list, create user, restricted page, restricted section all work. The editor's access panel still renders group chips and no longer leaks an instance per render.

**Verify.** `tests/test_access_control.py` in full, unmodified — 1,073 lines of pure HTTP that never touch a DOM id. New vitest test for `GroupChip` colour derivation (jsdom must stub `--group-sat`/`--group-light`). Manual: sign in as a read-only user, confirm `#editBtn`/`#deleteBtn` hide (they are toggled by `authoring.js:48` and `:62-75`, which this phase does not change), open a restricted document, confirm the placeholder swap. Manual: open the editor's access panel ten times and confirm the chip count in the DOM does not grow.

**Revert.** `git revert`.

---

### Phase 6 — Requirement tables, coverage overlay, report panel, runner chrome

**Goal.** The requirement/test tables inside the article, the coverage overlay's imperative build, `coverage-report.js`'s clear-and-rebuild panel, and `runner.js`'s hand-written `sync()`/`syncPill()`/`updateProgress()`.

**Files touched.** New: `app/svelte/ReqTable.svelte`, `TestCase.svelte`, `CoverageOverlay.svelte`, `CovLegend.svelte`, `CovExportButton.svelte`, `ReportPanel.svelte`, `VerifyingTests.svelte`, `AutomatedTests.svelte`, `StepReport.svelte`, `RunnerOverlay.svelte`, `RunTest.svelte`, `PassFail.svelte`, `actions/graph.js`, `actions/richtext.js`, `actions/fragment.js`, `stores/coverage.svelte.js`, `islands/coverage.js`. Modified: `app/js/coverage-view.js`, `app/js/coverage-report.js`, `app/js/runner.js`, `app/js/requirements/render.js`, `app/js/requirements/store.js` (+listener array only — **name and location unchanged**), `app/js/catalog.js` (`doc._rev++` inside `loadDoc`), **`app/js/reader.js`** (populate the `teardownMounted` registry landed in Phase 4 — this file is on the list because the leak fix has to have an owning phase), `app/css/coverage.css`, `app/css/requirements.css`. Unchanged: `app/js/coverage.js` (445), `app/js/report.js` (272), `app/js/requirements/parse.js` (314), `app/js/requirements.js` (232).

**Prerequisite: write the Playwright net first.** Grepping `tests/` for `cov-`, `req-badge`, `req-tbl`, `runner`, `covBtn` returns nothing. There is no coverage of this surface at all. Do not start the port until it exists.

**The store bridge, in place of the withdrawn rename.** `requirements/store.js` stays at `app/js/requirements/store.js`, keeps exporting `index`, `testIndex`, `groupsByDoc`, `statusOf`, `setComponentBySource`, `componentOf` and `setCoverageStatus` exactly as its three vanilla importers (`parse.js:9`, `render.js:11`, `requirements.js:26` and `:29`) expect, and gains five lines:

```js
const statusListeners = [];
export function onStatusChange(fn) { statusListeners.push(fn); return () => { /* … */ }; }
// inside setCoverageStatus, after the map is replaced:
for (const fn of statusListeners.slice()) { try { fn(); } catch (e) {} }
```

`app/svelte/stores/coverage.svelte.js` subscribes and exposes `covStatus = $state({ version: 0 })`; components read `statusOf(id)` inside an expression that also reads `covStatus.version`, so a status replacement repaints every badge without a `renderDoc`. No runes file is reachable from a natively-loaded `/js/` import, which is the rule §0.8 makes absolute.

**Three carve-outs:**
- `createGraph()` → `use:graph` action. Calls the controller on mount, `destroy()` on teardown, `setStatus`/`setStatusFilter` from narrow `$effect`s, and stashes `getTransform()` into module state before destroy so `covTransform` survives reopen.
- `richText()` → `use:richtext={{value, onchange}}`. The contenteditable is never re-rendered from state. `runner.js:12` imports `richText` from the `editor.js` barrel and uses it at `:169` and `:188` — that import must keep working, so `app/js/editor/richtext.js` stays a plain module.
- **The export button.** `CoverageOverlay.svelte` renders `.cov-export-btn` with the same title text; its click handler calls `exportReport()`, which stays a plain function in `coverage-view.js` and keeps importing `downloadFile`/`isoDate` from `/js/app-shell.js` and calling `generateReportHtml()` from the frozen `report.js`. Neither `downloadFile` nor `isoDate` moves.

**Do not let Svelte own the markdown content.** Keep `blockMarkdown()`/`inlineMarkdown()` returning sanitized `DocumentFragment`s and inject them with `use:fragment` into otherwise-empty cells. Components own the table *structure* (rows, badges, links, Run button, status pills); the rendered markdown stays plain non-Svelte DOM the existing highlighter and block renderers can keep mutating — and which the Phase 4 contract now keeps find-in-page away from.

**The placeholder bridge.** Keep `preprocessRequirements` exactly as written — a pure string→string pass over raw Markdown, before the parser. Replace only `renderRequirements`' `pre.replaceWith(builtTable)` (real call site `requirements/render.js:182-192`) with a mount-and-track bridge:

```js
import { mount, unmount, flushSync } from 'svelte';
const live = new WeakMap();                       // article -> instances[]

export function renderRequirements(article, docId) {
  const instances = [];
  article.querySelectorAll('pre > code.language-reqgroup').forEach(code => {
    const pre = code.parentElement;
    const block = lookupBlock(code.textContent.trim(), docId);
    if (!block) { pre.remove(); return; }
    const host = document.createElement('div');
    host.className = 'wd-mounted';                // display:contents; excluded from
    pre.replaceWith(host);                        // find-in-page and link resolution
    instances.push(mount(block.kind === 'test' ? TestCase : ReqTable,
                         { target: host, props: { block } }));
  });
  flushSync();                                    // DOM exists before later passes
  live.set(article, instances);
}

export function teardownRequirements(article) {
  (live.get(article) || []).forEach(unmount);
  live.delete(article);
}
```

`flushSync()` is mandatory: `revealRequirement`'s `document.getElementById` runs inside a single `requestAnimationFrame` at `main.js:179-181`, and anything rendered in an `$effect` lands after that rAF — the deep link then fails silently with no error.

**The one line that decides whether this is a clean port or a continuous leak:** `renderDoc` must call `teardownRequirements(previousArticle)` **before** `content.textContent = ''` (`reader.js:33`). Detaching a node does not run Svelte 5 teardown. `renderDoc` fires on every route change, on the 4-second external-change poll (`main.js:351`) and after every runner save (`main.js:246`), so without this the leak is continuous. Phase 4 already installed the `teardownMounted` hook and its test; this phase registers into it.

**Revision counter.** `{#key doc.id}` will **not** re-render on two real paths: `main.js:349-351` (external file change) and `main.js:246` (test-run saved) both call `renderDoc` on the *same* `Doc` object with the *same* id after `catalog.loadDoc` mutated it in place. `doc._rev++` in `loadDoc`, key on `doc.id + ':' + doc._rev`, and mirror it through `shell.rev`.

**Keep `webdoc:run-test` as a `CustomEvent`.** Its whole value is crossing from a non-Svelte-owned article and from the coverage panel into `main.js:237` without an import. Collapse it only after both ends are components.

**Exit criteria.** Coverage overlay opens, legend toggles filter, the export button downloads a report, the resize grip works, the report panel shows verifying and automated tests, the runner runs and saves, badges recolour after a save **without** a full `renderDoc`, and typing in `#docSearch` on a requirement-table document leaves the tables live.

**Verify.** The Playwright net written as this phase's prerequisite, plus the browser-side guard test on `report.js` (§7) and a leak test that navigates fifty times and asserts a bounded node count.

**Revert.** `git revert`. A hand-revert must restore `requirements/render.js`'s `pre.replaceWith(builtTable)` and the four modified modules; `store.js` needs no rename undone, which is the point.

---

### Phase 7 — Map chrome (canvas engine wrapped, never ported)

**Goal.** Toolbar, search, edge legend, Map-by dropdown, group legend, edit controls, empty state.

**Files touched.** New: `app/svelte/MapOverlay.svelte`, `MapToolbar.svelte`, `MapSearch.svelte`, `EdgeLegend.svelte`, `MapModeSelect.svelte`, `GroupLegend.svelte`, `EditControls.svelte`, `MapEmpty.svelte`, `GraphCanvas.svelte`, `islands/map.js`. Modified: `app/js/map-view.js`, `app/js/graph.js`, `app/js/graph/chrome.js` (builder half deleted; state machine inverted to an emitter), `app/js/graph/interactions.js` (the two teardown lines at `:205-206`), `app/js/graph/util.js` (dead exports), `app/css/graph.css`, **`app/dev/graph-demo.html` + its extracted `graph-demo.js`**. Unchanged: `app/js/graph/render.js`, `view.js`, `layout.js`, and the canvas half of `interactions.js`.

**`app/dev/graph-demo.html` is ported in this PR, not left to rot.** Its script imports `createGraph` from `/js/graph.js` and calls `createGraph(stage, docs, {...})` with a container `div`; Phase 7 replaces that signature and deletes both `container.textContent = ''` calls. Nothing in `tests/` exercises it (`tests/` references only `/dev/conformance-full.html`), so it would break silently. Update it to `createGraphController(canvasEl, docs, {...})`, keep its `window.__graph` hook, and load it manually as part of this phase's verification.

**Prerequisite: write the Playwright net first**, against `window.__graph`. It exists solely as a hit-test hook and **nothing in `tests/` references it at all** — outside `graph.js:207-209` its only occurrence in the repository is `app/dev/graph-demo.html:93`. Open the map, `count()` nodes, `nodeAt()`/`center()` a known node, click it, assert navigation; `setTransform`/`redraw` and assert fit; toggle a legend category; enter edit mode and assert the hint text.

**Four mechanical requirements:**
1. **Delete both `container.textContent = ''` calls** (`graph.js:172` and `interactions.js:205`). If chrome becomes components mounted inside the same container, both calls rip Svelte-managed DOM out from under live instances. This is the single highest-probability way to break this phase.
2. **Give `window.__graph` one owner** — `GraphCanvas.svelte`'s `onMount`, cleared in the teardown return. Today every `createGraph` call assigns it and `destroy` never clears it, so the coverage instance silently overwrites the map's and a destroyed instance stays reachable.
3. **`hiddenGroups` must be reassigned, never mutated in place** — or held in a `SvelteSet`. It is passed by reference from `map-view.js`'s `docMapState` into `g.hiddenGroups` and mutated in place by the group-legend click handler *and* by `onGroupToggle` — two writers, one object. A `$state` rune does not see in-place `Set` mutation (Svelte proxies plain objects and arrays only). It will appear to work and then not repaint.
4. **`#graphOverlay` already exists** because Phase 2 moved its creation into `ensureOverlayHosts()` during boot. That is what lets `mount(MapOverlay, { target: el('graphOverlay') })` happen without ordering this phase against `boot()` — and it is why the overlay contract had to move to Phase 2 rather than being "migrated before touching the component" here.

Refactor `createGraph` to take a **canvas element** instead of a container it may wipe:

```js
createGraphController(canvasEl, docs, opts) -> {
  destroy, fit, focus, search, setCurrent, setEditMode, setConnector,
  setMapMode, setVisibility, setHiddenGroups, setStatus, setStatusFilter,
  getTransform, getEditState, getNodePositions, on(evt, cb)
}
```

Two mandatory internal changes: delete both container wipes, and replace the chrome-mutating calls (`g.updateHint`, the `classList`/`aria-pressed` writes in `setConnector`/`setEditMode`) with an emitter, so the controller *reports* `{editMode, connector, pendingSourceTitle, selectedEdge, visibility}` outward and never touches a button.

Bridge with **narrow** `$effect`s, one per concern — never one big effect. Do **not** put `docs`/`traceEdges`/layout in an `$effect`; express it with `{#key modelVersion}` around `GraphCanvas` and pass the previous `getNodePositions()` snapshot in as `animateFrom` to preserve the existing tween.

**Dead code to clear first, so it is not faithfully reproduced:** `graph/util.js` exports `cssEscape` and `edgePath` that nothing imports; `chrome.js:118-121` builds a `.graph-new-btn` behind `if (g.onCreate)`, and `graph.js:145`'s `opts.onCreate` is never supplied by any caller — note that `authoring.js:97` *does* pass an `onCreate`, but to `openNewDocModal` (`editor/panels.js:199`), which is unrelated. Also `map-view.js`'s `buildDocGraph` declares a `keepView` parameter that four call sites pass and the function body never reads.

**Exit criteria.** Map opens, pans, zooms, fits, searches, filters edges, switches Map-by mode, toggles groups, enters and exits edit mode, creates and deletes relations. `app/dev/graph-demo.html` still runs.

**Verify.** The `window.__graph` Playwright net from the prerequisite, plus a manual load of `app/dev/graph-demo.html`.

**Revert.** `git revert`.

---

### Phase 8 — Remaining documentation and requirements amendment

**Goal.** Make the docs true. Its own reviewable commit. (The `tests/README.md`, `tests/requirements-dev.txt` and `.gitignore` corrections already landed in Phase 1; §1 requires them in the same commit as `package.json`.)

**Files touched.** Everything in §8 not already shipped in Phase 1.

**Exit criteria.** No file in `docs/` or `tests/` asserts a claim contradicted by the repository.

**Verify.** `grep -rn "no build step\|zero third-party\|no package.json\|no Node\|dependency-free\|hand-written" docs/ tests/ app/ .gitignore` returns only amended, still-true instances.

**Revert.** `git revert`.

---

### Not a phase: the editor

`app/js/editor.js` and `app/js/editor/**` are **out of scope for this plan entirely**, with the single named exception of the two `destroyGroupChip` calls added in Phase 5. See §6.7. `app/js/authoring.js` is *not* covered by that non-goal; see §0.7 for its exact, bounded scope.

---

## 6. Surface-by-surface recipes

### 6.1 Application shell — `main.js`, `index.html`, `app-shell.js`

**Call: keep as plain module. Do not port.**

This is a deliberate divergence from the shell survey's own recommendation, and the reason is boot ordering. `boot()` has eleven hard sequencing constraints and every violation fails *silently*:

1. The inline theme script in `app/index.html:9-17` stays a real inline `<script>` in `<head>`, before the stylesheets. Svelte never owns first paint.
2. `loadSite()` before anything reading `site.sources`.
3. `loadAuth()` before **any** `/api/index/*` call — two independent reasons: `GET /api/auth/me` is the only place the `wd_csrf` cookie is minted (`serve.py:592-611`), *and* the index endpoints answer per-principal (`serve.py:489` zeroes `docs` for an unauthenticated reader).
4. If `signInRequired()`, the wall blocks before the library loads, and `loadAuth()` runs **again** afterwards (new session, new CSRF).
5. `waitForIndex()` gates the tree — `serve.py:492` answers 503 for every `/api/index/*` while building, so an early tree render yields an **empty tree, not an error**. On a fresh clone with no `.webdoc-index/`, that build is the entire cold-start cost.
6. `loadPlugins()` before the first `renderDoc` — plugins register block renderers by import side effect, so too early means a mermaid fence renders as a plain code block.
7. `buildRequirementIndex()` before the first `renderDoc`.
8. `location.replace` (not `assign`) for the empty-hash default.
9. `body[data-app-ready]="1"` **last**, after the first document settles — which from Phase 4 means after `renderDoc`'s `flushSync()`, not merely after its promise resolves.
10. `startChangeWatcher` after the first route, so the generation baseline is not sampled mid-build.
11. **The generation-baseline rule.** `let lastGeneration = null` is declared at `main.js:319`; the rule itself is `main.js:329` — the *first* sample of `/api/index/status` records `lastGeneration` and must **not** trigger a refresh. Get it wrong and the app force-reloads the current document ~4 seconds after every boot, which presents as a flicker bug rather than a logic bug.

Component lifecycle hooks fire in tree order with no ordering guarantee against in-flight fetches. A vanilla boot function can mount Svelte islands at exactly the right moment; the reverse is not true.

**The `app` service registry hand-off, stated explicitly.** `app.closeDrawer` (`main.js:228`), `app.updateDocActions`, `app.closeMapView` and `app.closeCoverageView` are called by modules that are not ported in the same phase. The rule: **a registry entry is only replaced when both ends are components, and until then the registry entry must remain callable before its island has mounted.** Concretely, every registry function whose implementation moves into a component keeps a vanilla wrapper that no-ops (or defers to the pre-mount vanilla path) when the island is absent, and the wrapper carries a comment naming the phase that retires it. A registry call that throws because an island has not mounted is a boot-order failure by another name.

`app/index.html` stays **byte-identical**: no new `<script>`, no new `<link>`, no attribute change. Components mount **into** existing ids with `mount(C, { target: el('treeList') })`, which *appends* rather than replaces. That covers every chrome id — but not `#covOverlay` or `#graphOverlay`, which do not exist in the shell at all and are created at runtime by `coverage-view.js:58` and `map-view.js:233`. Phase 2 moves their creation into an eager `ensureOverlayHosts()` so that by the time Phases 6 and 7 mount into them, they are as stable as the shell's own ids.

**Rule — the transcription principle, stated as a review criterion:** the first Svelte commit on any surface reproduces the existing markup exactly — same tags, same classes, same attribute values, same order. Every e2e selector then passes by transcription rather than by care. This applies to CSS class names as strictly as to ids, which is what makes `graph.css` (225 lines) survive Phase 7 unedited except for additions.

**Rule — one owner per attribute, in a comment on every element components touch.** In an islands strategy, two writers is the *default* outcome at every boundary. Concretely: `documentElement.style.overflow` is written in exactly two places app-wide (`main.js:103` and `:109`); `documentElement[data-theme]` is written by the inline head script and by `setupTheme`, and **observed** by `graph/render.js:262`'s `MutationObserver` to repaint the canvas.

**Rule — mount targets are never owned by the component mounted into them.** `mount()` appends children into a target; a component cannot set an attribute on the element it was mounted into. The ten `hidden`-toggled chrome nodes are all mount targets or vanilla-owned siblings, and every one keeps its existing vanilla writer:

| node | writer, unchanged |
|---|---|
| `#accountBtn` | `auth-ui.js:150` |
| `#editBtn`, `#deleteBtn` | `authoring.js:48`, `:62-75` — a file this plan does not restructure |
| `#newDocBtn` | `authoring.js:48` |
| `#footPrev`, `#footNext` | `reader.js` |
| `#scrim`, `#doc-tree` | `main.js:101`, `:107` (`setupDrawer`) |
| `#treeList`, `#searchResults` | `main.js:130-131` (`setupDrawerSearch`) |

**Inside** a component, prefer `hidden={...}` over `{#if}` until the suite is re-baselined: `to_be_hidden()` still passes with `{#if}`, but `to_have_count(1)` and `query_selector` do not — and those failures read as unrelated flakiness.

**Rule — `aria-expanded={open}`, never `aria-expanded={open || undefined}`.** `tests/test_e2e.py:131` asserts the literal string `"false"` after close; the `|| undefined` form drops the attribute. (`#hamburger` stays vanilla, so this rule applies to any *new* expandable a component introduces.)

---

### 6.2 Navigation and search — `tree.js`, `search.js`, `catalog.js`

**Call: port to component (tree/search results), keep as plain module (`catalog.js`, `search.js`, `setupDrawer`).**

`app/js/search.js` — all 44 lines import unchanged. `app/js/catalog.js` — `loadSite`/`loadDoc`/`splitMeta` import unchanged, minus the dead code deleted in Phase 0 and plus the `_rev` counter added in Phase 6. It is **not** a frozen file.

Components: `DocTree`, `TreeFolder` (recursive by self-import, not `<svelte:self>`), `DocLink`, `SearchHitList`, `SearchHit`.

**Keep `<details>`/`<summary>`.** Swapping to `<button>` + `{#if}` to get transitions loses native `aria-expanded`, native keyboard operability, browser find-in-page opening collapsed sections, and the `.tree summary::before` / `.tree details[open] > summary::before` chevron CSS at `app/css/app.css:209-210`.

**`role="tree"` on `#treeList` is already broken** — `app/index.html:75` declares it but `tree.js` emits `<details>`/`<summary>`/`<a>` with no `role="treeitem"`, no `aria-level`, no `aria-setsize`/`posinset`. Decide during the port whether to implement the full tree pattern or drop `role="tree"`. Do not carry the half-implementation forward.

**The drawer's existing focus restore is behaviour, not decoration.** `main.js:98`/`:100` capture `document.activeElement` on open; `main.js:110` calls `lastFocus.focus()` on close. `setupDrawer` stays vanilla precisely so this survives untouched. There is separately **no focus trap** today — grepping `main.js`/`auth-ui.js`/`map-view.js` for `Tab` returns nothing, and the drawer is a `<nav>` with no `role="dialog"`, no `aria-modal`, no `inert`, so Tab walks straight out into the header. Adding a real trap is new behaviour, not a port (non-goal 11).

**Mutable `Doc` objects are invisible to reactivity.** `catalog.loadDoc` mutates the `Doc` in place and caches with `doc._loaded`; `state.byId` is a plain `Map`. Components read the `shell` store (§2), never a `Doc` off the shared map.

---

### 6.3 Reader pipeline — `reader.js`, `commonmark.js`, `md/*`, `sanitize.js`, `highlighter.js`, `blocks.js`

**Call: keep as plain module (2,827 lines frozen), wrap as action (the article), port to component (the satellites), mount at exactly two host kinds inside the article under §2's contract.**

**Frozen, zero edits (2,827 LOC):** `commonmark.js` (51), `md/*.js` (1,776), `highlight/*.js` (567), `highlighter.js` (94), `doclinks.js` (190), `sanitize.js` (149). Verified DOM-free by grep, except `sanitize.js` and `highlighter.js`, which are DOM-*producing* by design and frozen for that reason. `blocks.js` (186) is frozen too but listed separately in §0.1 because it is an article pass rather than a parser component. `catalog.js` is **not** in this list — it is edited in Phases 0 and 6.

**The article: a host plus an action, never `{@html}`, never a whole-article component.**

```svelte
<div class="doc-host" use:renderedDoc={{ doc, rev }}></div>
```

`renderedDoc` is `reader.js`'s `renderDoc` lifted almost verbatim: `create` builds and appends the article and runs all eleven passes in exactly today's order; `update` tears down (including `teardownMounted`) and rebuilds; `destroy` disconnects the scroll-spy observer and aborts the in-flight generation token.

**Two pre-existing bugs to fix with the port** (the previously listed third — a leaking scroll-spy singleton — does not exist; `reader.js:248` already disconnects before every rebuild):
- **Generation token.** `resolveLinks` (`reader.js:143`) awaits `/api/index/resolve` and the async `renderBlocks` branch awaits mermaid; neither checks whether the article is still mounted. Capture `const gen = ++renderGeneration` at action start; both async passes bail if `gen !== renderGeneration`. Pass an `AbortSignal` into the resolve fetch.
- **Revision counter.** `doc._rev++` in `loadDoc`, keyed as `doc.id + ':' + doc._rev` (§5, Phase 6).

**Pipeline order is a contract.** `numberHeadings` slugifies `h.textContent` while the requirement placeholders are still `pre > code.language-reqgroup` — pass 3 has not run. Reordering changes heading ids, breaking every in-page anchor, every `#/doc#frag` deep link, and `tests/test_e2e.py:186-194`. The comment at `reader.js:57` ("Heading ids exist now.") documents the dependency.

**The sanitizer's `language-*` exception is load-bearing.** `sanitize.js:95-103` strips every class except a single `/^language-[\w+.#-]+$/i` hint on `code`/`pre`, lowercased. That is the only reason `code.language-wd-restricted` survives to be selected by the restricted-section pass. Relatedly and deliberately: the server's `neutralise_forged_notices()` renames an *author-written* fence to `wd-restricted-example`, producing class `language-wd-restricted-example`, which does **not** match the selector — an author cannot forge a redaction notice.

**Satellites → components:** `Toc` (consume `numberHeadings`' return value as props; delete `buildTOC`; reproduce its click behaviour; keep `data-target` and `<span class="n">`; scroll-spy `.active` becomes `class:active={e.id === activeId}`), `Crumbs`, two `FootGroup` mounts. `#live` stays vanilla behind `announce()`. `#docSearch`'s *matching* work stays imperative inside the action.

---

### 6.4 Map / graph — `map-view.js`, `graph.js`, `graph/*`

**Call: wrap as action / controller. ~1,540 lines never become components.**

`graph/layout.js` (590, provably DOM-free, with its own LRU cache) and `graph/util.js` (78) import unchanged. `graph/render.js` (777), `view.js` (174) and the canvas half of `interactions.js` stay imperative. Only ~255 lines are genuine chrome.

Its mount target, `#graphOverlay`, is created by `map-view.js:233` today and by Phase 2's `ensureOverlayHosts()` afterwards. Its stylesheet is `app/css/graph.css` (225 lines), which stays global and keeps every selector name.

**Note:** `app/js/panzoom.js` is **not** part of this surface. Its only importer is `app/thirdpartyrenderer/mermaid.js`. Do not plan to unify it with the map's independent pan/zoom.

Full mechanics in §5, Phase 7.

---

### 6.5 Requirements, coverage, runner, report

**Call: keep as plain module (1,031 lines), port to component (~900 lines), two awkward bridges.**

**Frozen:** `coverage.js` (445), `report.js` (272), `requirements/parse.js` (314).

**`app/js/report.js` is frozen but is not a pure string builder, and its guard test is a browser test.** `report.js:32-34` and `:37-39` build a `div`, append a sanitized fragment, and return `innerHTML` — a fragment→string round trip inside the frozen zone. It is safe because the string is written to a downloaded file, never re-parsed into this document. Two consequences: (a) the "no DOM" claim about this file is withdrawn, and (b) `generateReportHtml()` cannot be called from a Python test. Its guard test therefore runs in Playwright, evaluating `generateReportHtml(...)` in the page and asserting the output contains no `<script`, no `import `, and no Svelte marker — so its own header's promise ("inline CSS, no scripts, no external assets, zero third-party — does not need the WebDocs server or app to view") stays true on purpose rather than by luck.

**`requirements/store.js` keeps its name, its path, and its three vanilla importers.** See §5, Phase 6 for the listener bridge that replaces the withdrawn `store.svelte.js` rename.

**The placeholder bridge, the `flushSync`, the `.wd-mounted` host class, and the teardown rule** are all in §5, Phase 6, and depend on the article contract landed in Phase 4.

**The coverage overlay's export path has an owner:** `CovExportButton.svelte` renders `.cov-export-btn`; `exportReport()` stays a plain function in `coverage-view.js`; `downloadFile`/`isoDate` stay in `app-shell.js:101`/`:112`.

**Keep `webdoc:run-test` as a `CustomEvent`.**

---

### 6.6 Accounts and access control

**Call: `auth.js` keep as plain module; `auth-ui.js` port to component; the restricted-section swap wrap as action.**

Covered in Phase 5. The key structural note: `auth.js` is 366 lines that **do not construct or query the document tree**, but it is not DOM-free — `auth.js:220` reads `document.cookie` and `auth.js:294-296` reads `--group-sat`/`--group-light` off `documentElement` via `getComputedStyle`. Nine modules read its mutable `auth` object directly. The adapter over the existing `onAuthChange` observable is the whole integration; both DOM touches stay exactly where they are, which is why those two custom properties must not migrate out of `:root` (§0.9).

`GroupChip.svelte` is the highest-leverage first port here, and it keeps a DOM-returning adapter **named `groupChip`** that returns the host and retains the instance handle. See Phase 5.

`body[data-auth]` (written once at `main.js:390`) has **zero readers** — no CSS rule, no Playwright selector, no other JS. Either delete it as dead or keep writing it deliberately.

`showSignInWall()` returns `Promise.resolve()` when a wall already exists, so a second caller resolves *as if sign-in succeeded* and immediately runs `location.reload()`. Preserve or fix deliberately; do not reproduce it by accident in a component that resolves on mount.

---

### 6.7 The WYSIWYG editor — out of scope

**Call: do not touch, with one named two-line exception (the `destroyGroupChip` calls in Phase 5).**

`app/js/editor.js` + `app/js/editor/*` = 1,767 lines. (With `authoring.js`'s 457 that surface totals 2,224 — but `authoring.js` is separately scoped in §0.7 and is **not** covered by this non-goal.)

**Why contenteditable and a reactive framework fight, precisely.** A reactive renderer's contract is "the model is the truth; I will make the DOM match it." A contenteditable's contract is the exact inverse: "the browser and the user are the truth; the DOM *is* the document." Both claim the same nodes. The user types → the browser mutates the DOM → the input handler reads `innerHTML` into the model → the model is reactive → the renderer replaces the DOM the browser just authored. Even when the output HTML is identical, the *nodes* are new, so the caret (a node+offset pair) is lost, the IME composition is cancelled, and the native undo stack is orphaned.

**Specific, verified hazards:**
- **IME will break outright.** Grepping all of `app/js` for `compositionstart`, `compositionend`, `beforeinput` and `paste` returns **zero matches**. `onInput: () => onChange(ed.innerHTML)` fires *mid-composition* on Chromium, which is harmless today only because nothing ever writes the model back.
- **Undo is already partly broken and re-rendering makes it worse.** `execCommand('bold'|'italic')` pushes onto the native stack; `Range.insertNode`/`surroundContents`/`extractContents` do not. There is no application-level undo to fall back on.
- **Stale `Range` across an async boundary.** `addLink` (`richtext.js:117`) and `addImage` (`:176`) clone the live `Range`, open a popover, and use that clone *after* the user types a URL and clicks Apply.
- **`$state` deep-proxy aliasing.** `blocks = opts.blocks.map(b => ({...b}))` (`editor.js:99`) is **shallow**: `itemsHtml`, `rows`, `steps`, `headers`, `aligns` and `read` are the same array objects `parseDoc` produced, and every widget mutates them in place. Under Svelte 5 deep proxies, the value reached through the proxy and the same value reached through a retained raw reference are different objects.
- **`root.normalize()` deletes Svelte's anchors.** `mount()` appends an **empty text node** as its block anchor (not a comment node), and `normalize()` removes empty text nodes outright. Anywhere `normalize()` runs over Svelte-owned DOM, the anchors are gone. (This cuts the other way for `:empty`: comments and empty text nodes do not stop `:empty` from matching, so `app/css/editor.css:60`'s `.blk-edit:empty::before { content: attr(data-ph) }` is *not* the hazard it was previously claimed to be. The real `:empty` hazard is text or element children, and `.req-trace-chips { display: contents }` at `editor.css:103` is likewise unaffected by anchors alone. The editor stays out of scope on the other five grounds, not this one.)
- **The failure mode is silent data loss, not a crash.** `serializeDoc` is normalize-on-save: every save regenerates the entire file from the block model. A block the model drops is a block deleted from disk. `parseDoc` already returns a `lostMarkers` counter and `authoring.js:148-157` **refuses to open the editor** when it is non-zero, precisely because a dropped `<!--access start-->` marker silently publishes a restricted section.
- **Zero tests.** No test in `tests/*.py` references `.blk`, `.editor`, `contenteditable` or `#editBtn`.

**What would have to be true first** (roughly 6 days of prerequisite work, worth doing whether or not Svelte ever lands here): a round-trip fidelity Playwright suite over a fixture containing every block type plus a fenced example of an access marker, a relative image, and a table cell with inline markup; caret-survival tests; `compositionstart`/`compositionend` guards; a `beforeinput`/`paste` hook running `sanitizeToFragment`; a **deep** block clone; and stable per-block uids.

**And the invariant that holds regardless:** `app/js/editor.js` must keep exporting `richText`, `setLinkSearch`, `parseDoc`, `openNewDocModal` and `confirmDialog` as plain callable functions, because `runner.js:12` and `main.js:7` import them.

**If it is ever attempted**, the only acceptable shape is Svelte owning the frame and an action owning the contents, with a deliberately empty `update()`:

```js
export function editableField(node, { initial, onChange }) {
  node.contentEditable = 'true';
  node.innerHTML = initial;                 // ONCE, at mount, and nowhere else
  attachInlineToolbar(node);
  const on = () => onChange(node.innerHTML);// DOM -> model only, forever
  node.addEventListener('input', on);
  return {
    update() { /* DELIBERATELY EMPTY - load-bearing. Never model -> DOM. */ },
    destroy() { node.removeEventListener('input', on); }
  };
}
```

The empty `update()` is the whole trick and must carry that comment.

---

## 7. Testing strategy

### The DOM-id contract

`app/index.html` stays byte-identical and components mount **into** existing ids, so the shell's selector contract survives by transcription:

`body[data-app-ready="1"]` (6 assertions), `html[data-theme]` + `localStorage['wd-theme']`, `#content` and `#content .doc` (count exactly 1), `data-heading-number` on h1..h6, `#tocList a .n`, `#themeBtn[aria-pressed]`, `#hamburger[aria-expanded]` rendering the literal string `"false"`, `#doc-tree`, `#scrim`, `#treeList a.doc-link[data-id='...']`, `#footPrev`/`#footNext` with `#/<id>` hrefs, `a.skip[href="#content"]` count 1.

Two mount targets are **not** covered by that argument — `#covOverlay` and `#graphOverlay` are created at runtime by the modules being replaced — which is why Phase 2 moves their creation into an eager `ensureOverlayHosts()` and why Phases 6 and 7 each carry a prerequisite Playwright net.

The previously listed `.foot-missing` contract is **removed**: the class exists nowhere in `app/` or `docs/`, `buildFootGroup` (`reader.js:224-237`) always emits an `<a>`, and the test at `tests/test_e2e.py:255` already self-skips for lack of a fixture. Phase 0 deletes it.

### Existing suites

**`tests/test_access_control.py` (1,073 lines) — passes unmodified.** Pure HTTP, no Playwright, by deliberate design. All three build-sensitive assertions survive: `:747`'s `assert c.get("/js/main.js").status == 200` stays true because `main.js` is still a real served file; `:736-739`'s no-`unsafe-inline`/no-`unsafe-eval` stays true (verified zero `eval`/`Function` in the built output); `:730-734`'s security headers are untouched.

**One improvement anyway.** Replace `:747` with the build-agnostic form: fetch `/`, parse the `<script type="module" src="...">` out of the shell body, assert that URL returns 200 while signed out.

**`tests/test_conformance.py` — needs Phase 0 work, not zero work.** `app/dev/conformance-full.html` carries an inline `<script>` at `:9` and an inline `<script type="module">` at `:102-272`, and `_inline_script_hashes` (`serve.py:178`) hashes only `app/index.html`, so under the real CSP both are blocked, `body[data-done='1']` is never set, and the test hangs to its timeout. Phase 0 extracts them to external files. After that the harness's `import { renderMarkdown } from '/js/commonmark.js'` still resolves to the hand-written parser, because `app/js` is never bundled and `app/dev` is never a build input.

**`tests/test_e2e.py`** — corpus authored and stale assertions fixed in Phase 0, then updated deliberately in Phase 3 (tree expansion) and Phase 4 (TOC focus, `#toc` empty state) and nowhere else.

**`tests/conftest.py`** — fixed in Phase 0 (derive `APP_DIR` from `__file__`, start `serve.py` in the fallback).

### New Python tests

| test | phase | what it guards |
|---|---|---|
| `tests/test_build_current.py` | 1 | Runs `npm run build`, fails if the working tree changes. `pytest.skip` when `node` is absent, so the Python-only contributor is never blocked. |
| `tests/test_build_externals.py` | 1 | **The guard for the #1 Critical risk, which nothing else covers.** Asserts that `app/build/islands.js` contains zero inlined copies of any `app/js` module — concretely, that identifiers unique to those modules (`accessCache`, `onSelectCb`, `spyObserver`, `lastGeneration`, `docFromId`) appear **nowhere** in the bundle, and that every `from "/js/…"` specifier the bundle emits corresponds to a real file. Also asserts `entry.js`'s declared export names are all present in the output (which is what would have caught Rolldown tree-shaking them away). `keepNative` and the eslint rule are both build-time-only; neither survives a plugin ordering change, and this test does. Skips without `node`. |
| `tests/test_csp_self_consistency.py` | 1 | `GET /`, regex the inline scripts out of the **response body**, sha256 each, assert every hash appears in that same response's `Content-Security-Policy` header. **Must branch on the two escape hatches**: `build_csp` returns `None` when `auth.security_headers` is falsy (`serve.py:1506-1507`) and returns `auth.content_security_policy` verbatim when an operator override is set (`:1508-1509`). `pytest.skip` in both cases with an explicit reason, rather than asserting against a header that is absent or hand-written. Guards a failure mode (theme flash + console violation) that nothing else observes. |
| node-free clone gate (`sys_9`) | 1, Job B | Fresh clone into a container with no `node`, no `node_modules`, no network; `python serve.py`; **poll `/api/index/status` until the cold index build completes, with an explicit timeout** (a fresh clone has no `.webdoc-index/`, and `serve.py:492` answers 503 until it finishes); run the HTTP suite; assert `body[data-app-ready="1"]`. Converts `sys_9` from a claim into a tested requirement and catches anyone quietly gitignoring the build output later. |
| build freshness gate | 1, Job A | `npm ci && npm run build && git diff --exit-code -- app/build/`. Depends on `.gitattributes`'s `-text eol=lf` to survive `core.autocrlf`. |
| article-mutator contract | 4 | Type into `#docSearch` on a requirement-bearing document; assert the article's node count and the mounted hosts survive. Written before anything is mounted inside the article. |
| mount/unmount leak | 4, extended in 6 | Navigate fifty times; assert a bounded node count and that `teardownMounted` ran once per navigation. |
| `report.js` standalone guard | 6 | **A Playwright test, not a Python one** — `generateReportHtml()` needs a DOM (`report.js:32-39`). Evaluate it in the page; assert the output contains no `<script`, no `import `, no Svelte marker. |
| map coverage | 7 prerequisite | Against `window.__graph`: node count, `nodeAt`/`center` + click + navigation, `setTransform`/`redraw` + fit, legend toggle, edit-mode hint text. Plus a manual load of `app/dev/graph-demo.html`. **None of this exists today.** |
| coverage/runner coverage | 6 prerequisite | `#covBtn`, `.cov-*`, `.cov-export-btn`, `.req-badge`, `.req-tbl`, runner overlay. **None of this exists today.** |

### What Svelte newly enables

Component tests with `vitest` + `@testing-library/svelte` + `jsdom`, run by `npm test` (the script exists in §3's manifest), entirely separate from the Python suite. Highest value, in order:

1. **`TreeFolder`** — expansion state, lazy level loading, `aria-current` derivation. Today this behaviour is only reachable through a full Playwright boot.
2. **`SearchHit`** — the empty-snippet case. Note the existing quirk it fixes: `main.js:148` appends a stray empty text node when `snippet` is `''`, because `''` is neither `null` nor `false`.
3. **`PassFail` / `RunTest`** — the pass/fail state machine and progress derivation.
4. **`GroupChip`** — colour derivation, given `auth.js:294-296` reads `--group-sat`/`--group-light` off `:root` via `getComputedStyle` (jsdom needs these stubbed).

**Do not** attempt component tests for anything wrapped in an action — the graph controller, the article renderer, the contenteditable. jsdom has no canvas, no layout and no selection model worth trusting.

### The TypeScript posture, as written policy

`checkJs: true` over the existing JSDoc via `jsconfig.json`. **An explicit ban on a mass `.js` → `.ts` rename** — 12,528 lines with rich JSDoc and near-zero UI test coverage.

And the warning, verbatim: **if `svelte-check`'s initial error count gets a permanent ignore list rather than triage, that outcome is worse than not adopting type checking at all.**

---

## 8. Documentation and requirements changes

### Landing in Phase 1, with `package.json`

| file | lines | change |
|---|---|---|
| `tests/README.md` | 7-10 | "There is no Node.js, no npm, no `package.json` anywhere" — false the moment `package.json` lands. |
| `tests/README.md` | 10 | "two additional harness files under `app/dev/`" — there are **four** `.html` harnesses. |
| `tests/README.md` | 51 | "download Playwright's own Chromium (no Node involved)" — still true of Playwright; reword so it is not read as a claim about the repository. |
| `tests/README.md` | 94 | Stale `#reqBtn` reference (also Phase 0). |
| `tests/requirements-dev.txt` | comment block | Same false claim. |
| `.gitignore` | 1-6 | The comment claims excluding the vendored libraries "preserves the *nothing but hand-written vanilla JS ships* guarantee for a clean clone". Qualify: hand-written vanilla JS plus the compiled ~10 kB framework runtime. |

### Landing in Phase 8

| file | lines | change |
|---|---|---|
| `docs/requirements/system.md` | 31 (R_WD_SYS_6) | Amend row 6's text **in place**; append rows 9, 10, 11. Do **not** insert rows — `parse.js:238` builds the id from the row-number cell, and renumbering rows 7/8 silently repoints all twelve traces in `functional/access-control.md:21-32`. |
| `docs/overview.md` | 21 | "no build step, no bundler" → qualify: no build step to *run or author*; developing the browser app requires one. |
| `docs/overview.md` | 34-38 | The zero-dependency pillar → the amended claim with the ~10 kB figure. |
| `docs/overview.md` | 4 | Meta description. |
| `docs/design/architecture.md` | 118-127 | "The zero-dependency principle" — currently states there is no framework and no third-party runtime code anywhere in the browser application. |
| `docs/design/architecture.md` | 11 | "static, dependency-free". |
| `docs/design/architecture.md` | 72-88 | The single-static-shell description — `index.html` is still a static shell, so this is a *smaller* edit than it looks. |
| `docs/design/architecture.md` | 110, 122 | **Unrelated stale-docs bug, fix while there:** both claim the browser builds the search index. It has been server-side SQLite FTS5 since the lazy rewrite. |
| `docs/design/parser.md` | 8 | "no library, no dependency, no shortcuts" — still literally true of the parser; reword the surrounding framing so it is not read as a whole-application claim. |
| `docs/requirements/functional/highlighting.md` | 7 | "hand-written syntax highlighters" — still true; re-read and reframe. |
| `tests/test_conformance.py` | 5 | "hand-written parser" — still true; re-read and reframe the docstring's opening. |
| `docs/reference/performance.md` | 19-20, 25, 106 | Enumerates "zero third-party runtime dependencies, no Node, a standard-library-only server, no build step". |
| `docs/how-to/running.md` | 8 + meta | "There is no compile step and no bundler" → qualify. "Clone and run one python file" **survives verbatim**. |
| `docs/reference/config.md` | 10 | "There is no build step". |
| `docs/features/diagrams.md` | 12-13, 95-97 | "nothing but hand-written vanilla JavaScript ships to the browser". |
| `docs/features/search.md` | 59 | "keep the zero-dependency, no-backend promise intact". |
| `docs/features/highlighting.md` | 186-187 | Wording only — the highlighters really do stay hand-written. |
| `docs/features/test-coverage.md` | audit | Not previously audited. Re-read for the same claim class before Phase 6 changes that surface. |
| `docs/features/map.md` | audit | Same, before Phase 7. |
| `docs/how-to/authoring.md` | audit | Not previously audited. Expected to need **no change** (authoring claims stay true) — confirm rather than assume. |
| `docs/tests/*.md` | audit | `access-control.md`, `navigation.md`. Not previously audited. |
| `docs/roadmap.md` | 12-17 | Needs a **second** acknowledged exception alongside the BYO diagram library. |
| `docs/roadmap.md` | 109 | "hand-written, zero-dependency WYSIWYG block editor" — still true, since the editor is out of scope; the surrounding claim needs qualifying. |
| `docs/roadmap.md` | new | A new stage plus Feature-summary rows. While there, fix the pre-existing "built in ten stages" against eleven listed. |

### Requirement rows whose text survives, gloss needs rewording

| file | lines | change |
|---|---|---|
| `docs/requirements/functional/parser.md` | 11 | The parenthetical gloss "(zero third-party runtime dependencies)". |
| `docs/requirements/functional/parser.md` | 21, row 4 | "Use no third-party parsing library. \| sys_6" — **keep verbatim, still literally true.** |
| `docs/requirements/functional/access-control.md` | 14-16 | Prose "built on the Python standard library and hand-written browser code like everything else" — qualify for the browser half only. |
| `docs/requirements/functional/access-control.md` | 23, row 3 | "salted, iterated one-way hash \| sys_8, sys_6" — **keep**; the server half is still pure stdlib. All twelve rows' `sys_8` and `sys_7` targets are unchanged, which is the whole reason §1 appends rather than inserts. |
| `docs/requirements/functional/access-control.md` | 14-16 vs table | **Fix the pre-existing self-contradiction while there**: the prose says rows 9 and 10 trace to sys_6, but the table gives sys_6 only to row 3. |
| `docs/features/requirements.md` | 25 | Cosmetic — the sample table repeats "Use no third-party parsing library \| sys_6" as illustration. |

### Must be left alone — AUTHORING claims that remain completely true

`docs/how-to.md:11-12`; `docs/features/markdown.md:16`; `docs/reference/authoring.md:7` and `:14-15`; `docs/reference/config.md`'s authoring guidance. An author still has no build step, no front-matter processor, no Markdown library. Blanket-editing these would be the sloppy over-correction that makes the amendment look like a retreat.

### Unrelated stale-docs bug worth fixing in passing

`docs/requirements/functional/search.md` still describes a client-side index of titles and headings. Since the lazy-server rewrite, search has been server-side SQLite FTS5 over full body text with `bm25(10,4,2,1)` weighting (`webdoc_index.py:902-939`), and `app/js/search.js` is 44 lines of fetch. Same bug in `docs/design/architecture.md:110` and `:122`. This is a stale-docs bug, **not** a constraint change — fix it independently of the Svelte decision.

---

## 9. Risks and mitigations

| risk | likelihood | impact | mitigation |
|---|---|---|---|
| **Duplicate module instance.** A `.svelte` file writes `import { auth } from '../js/auth.js'` instead of `'/js/auth.js'`. Rolldown bundles a copy while the browser separately loads the original. Two `auth` objects, two `listeners[]`, two `accessCache` Maps. Sign-in appears to work; ACL decisions go stale; nothing throws. 14 modules hold module-level mutable state (`richtext.js` ×5, `map-view.js` ×3, `main.js` ×3, `requirements/store.js` ×2, `coverage-view.js` ×2, `auth.js` ×2, plus `tree.js`, `runner.js`, `reader.js`, `editor/widgets.js`, `editor/ui.js`, `blocks.js`, `authoring.js`, `auth-ui.js`). | Medium | **Critical — silent corruption** | Three independent guards: the `keepNative` plugin `this.error()`s on any relative import reaching `app/js`; an eslint `no-restricted-imports` rule; and **`tests/test_build_externals.py`**, which asserts the emitted bundle contains none of those modules' unique identifiers. The first two are build-time-only and neither survives a plugin ordering change; the third does. **Never rely on review alone.** |
| **A runes file reachable from a native `/js/` import.** `$state(...)` served verbatim is a `ReferenceError`; compiled instead, it forks the module. | Medium | **Critical** | §0.8's absolute rule (`app/js/` contains no runes, ever), an eslint path rule, and the bridge pattern in §2 that replaced the withdrawn `store.svelte.js` rename. |
| **Stale committed bundle.** Someone edits a `.svelte` file, forgets `npm run build`, commits source only. | High | High | `tests/test_build_current.py` + CI `git diff --exit-code -- app/build/`. Optionally a pre-commit hook. |
| **Line-ending churn defeats the freshness gate.** `core.autocrlf` is `true` on at least one dev machine and there is no `.gitattributes` today. | High (without the fix) | Medium | `.gitattributes` sets `-text eol=lf` on the bundle alongside `-diff -merge`. |
| **Merge conflict on the bundle, resolved by merging.** | Medium | High | `.gitattributes` `-merge` forces a manual conflict. Written rule: **always rebuild, never merge.** |
| **A rollback needs Node.** An incident revert that says "rebuild" is impossible on a Node-free operator machine, contradicting `sys_9`/`sys_11`. | Medium | High | §5's single revert procedure: `git revert <sha>` restores the previously committed bundle in the same operation. No phase's revert instruction contains the word "rebuild". |
| **Scope creep into the frozen zone.** Someone writes `{@html renderMarkdown(body)}`, reintroducing XSS through a pipeline that passes author HTML through unescaped by design (`md/render.js:87`, `md/inline.js:207`) with `sanitize.js` as the only gate. | Medium | **Critical** | `svelte/no-at-html-tags: "error"`, no per-file disables. A comment at the top of `sanitize.js` explaining why. |
| **`root.normalize()` deletes Svelte's anchors.** `mount()` appends an **empty text node**, and `normalize()` removes empty text nodes outright. `reader.js:288` runs it over the whole article on every `#docSearch` keystroke; `reader.js:298-317` additionally does `text.replaceWith(frag)` inside table cells. | **Certain, without the Phase 4 contract** | **Critical — silent detachment** | The five-point article contract in §2, landed in **Phase 4** with its own Playwright test, before Phase 6 mounts anything inside the article. |
| **CSP goes stale.** Not possible under this strategy (the build never writes `index.html`) — but the policy *is* computed once at `serve.py:1476` and cached. | Low | High | `tests/test_csp_self_consistency.py`, with explicit skips for the `security_headers=false` and operator-override branches. |
| **Dev harnesses silently CSP-blocked.** All four `app/dev/*.html` carry inline scripts; `_inline_script_hashes` reads only `app/index.html`. They pass today only because conftest's fallback sends no policy. | **Certain today** | Medium | Phase 0 extracts all four to external files — which is also what makes Phase 0's own conftest change survivable. |
| **`{#if}` instead of `hidden={}`** inside a component. `to_be_hidden()` still passes, so the mistake looks safe, but `to_have_count(1)` and `query_selector` fail — and read as flakiness. | Medium | Medium | The `hidden={}` rule, plus §6.1's mount-targets-are-never-owned rule, stated in a comment on every such element. |
| **`aria-expanded` dropped** via `{open \|\| undefined}`. | Medium | Low | `tests/test_e2e.py:131` catches it. Rule stated in §6.1. |
| **Mount without unmount.** `renderDoc` clears `#content` on every route change, on the 4s poll and after every runner save. Detaching does not run Svelte 5 teardown. **And `tree.js:101`'s `container.textContent = ''` runs from `main.js:346` every four seconds** — a Phase 3 hazard, not a Phase 6 one. | **High (from Phase 3)** | High | Phase 3 replaces **both** `renderTree` call sites (`main.js:416` and `:346`). Phase 4 lands `teardownMounted` + its leak test. Phase 6 registers into it, torn down **before** `content.textContent = ''`. |
| **Boot ordering scattered into `onMount`.** Eleven hard constraints, all failing silently. | Medium | High | `boot()` stays one awaited vanilla function. Non-negotiable, stated in §6.1. |
| **Registry call before its island mounts.** `app.closeDrawer`, `app.updateDocActions`, `app.closeMapView`, `app.closeCoverageView` are called by modules not ported in the same phase. | Medium | Medium | §6.1's hand-off rule: every migrated registry entry keeps a vanilla wrapper that is safe to call pre-mount, carrying a comment naming the phase that retires it. |
| **Scroll-spy dies silently.** `setupScrollSpy` reads `tocList.querySelectorAll('a[data-target]')` in the same tick the TOC is mounted; Svelte batches into a microtask. No error, and no existing test covers `.active`. | **High, without the fix** | Medium | `flushSync()` after `mountToc`, mandated in Phase 4 with a new `.active` Playwright assertion. |
| **`$state` over a `Set` or `Map`.** Svelte proxies plain objects and arrays only; `set.add(...)` notifies nothing. It appears to work and then does not repaint. | High | Medium | `SvelteSet`/`SvelteMap` from `svelte/reactivity`, applied in **Phase 3** (`tree.expanded`) as well as Phase 7 (`hiddenGroups`). |
| **Exporting a reassigned `$state` binding.** `export let activeDocId = $state('')` is a hard compile error (`state_invalid_export`), not a warning. | High | Low (build fails loudly) | §2's rule: export an object whose properties are mutated, or export getter/setter functions. |
| **`<svelte:self>` deprecation noise.** Emits `svelte_self_deprecated` on every build. | Certain (if used) | Low | Self-import by path in `TreeFolder.svelte`. |
| **Generation-baseline rule broken.** The first `/api/index/status` sample must record `lastGeneration` (declared `main.js:319`, rule at `:329`) and must **not** trigger a refresh. | Low | Medium | Stated as a rule wherever a phase touches index status. |
| **Two writers for one attribute.** `documentElement.style.overflow` (two sites app-wide), `documentElement[data-theme]` (written by the inline script and `setupTheme`, **observed** by `graph/render.js:262`'s `MutationObserver`). | High | Medium | One-owner-per-attribute stated in a comment on every element components touch. `setupDrawer` stays wholly vanilla; refcounted `scrollLock` for the overlays only. |
| **Scoped-CSS token orphaning.** `auth.js:294-296` reads `--group-sat`/`--group-light` off `documentElement`; `requirements.css`'s `.tc-result-*` consumes `--cov-*` from `coverage.css`. | Medium | Medium | §0.9: `.svelte` files carry **no** `<style>` block at all; all CSS stays in `app/css/*.css`. `emitCss: false` plus a build assertion that no style-injection call is emitted. |
| **Phase 2 ordered before the overlay contract.** `map-view.js:233` creates `#graphOverlay` at boot; lazy-loading it makes `el('graphOverlay')` null, and `authoring.js:93/:125/:304` dereference it unconditionally — a `TypeError` on the first create or delete. | **Certain, in the previous ordering** | High | The `app/js/overlays.js` contract and `ensureOverlayHosts()` land as Phase 2's **first** commit, before the import split. |
| **Phase 0 skipped or under-scoped.** The e2e suite is stale today and its target corpus does not exist. | Medium | High | Phase 0 is the gate for everything after it, and now includes authoring a fixture source rather than only repointing constants. |
| **Vite 8 / Rolldown API churn.** Two breakages hit in a single afternoon: `minify: 'esbuild'` fails outright; `inlineDynamicImports` deprecated. A future minor could move `build.lib`'s entry-signature behaviour and silently tree-shake the exports away again. | Medium | Medium | Exact pins, committed `package-lock.json`, and `tests/test_build_externals.py`'s exports-are-present assertion. |
| **Sourcemap leak.** `route()` serves `APP_DIR` before any ACL check (`serve.py:1036-1041`). | Low | High | `sourcemap: false` in the shipped build. Never commit one. |
| **Anything world-readable under `APP_DIR`.** `app/build/`, `app/svelte/`, and the empty `app/data/` are all served before any ACL check. `.svelte` has no `CONTENT_TYPES` entry and falls back to `application/octet-stream` with `nosniff` (`serve.py:283`), so it downloads rather than executes. | Certain | Low | Accept knowingly. `app/data/` gets a `.gitkeep` saying nothing private may go there. Closing the `app/svelte/` case is the one place a `serve.py` change might eventually be wanted. |
| **Mid-migration the app gets bigger.** The ~26 kB runtime is paid from Phase 3; vanilla bytes are only recovered when replaced modules are deleted. | Certain | Low | Phase 2's dynamic-`import()` split and the `_file` gzip change more than cover it. Say so in the roadmap rather than hiding it. |
| **Two idioms coexist indefinitely.** A contributor must know whether a file lives in the vanilla native-ESM world or the compiled Svelte world. | Certain | Medium | This is the strategy's honest position, not a temporary state. §0 is the answer, and it belongs in `CONTRIBUTING`. |
| **No HMR.** Edit-rebuild-refresh at ~76 ms plus a page load. | Certain | Low | Measured: 119 ms initial build, 76 ms incremental. Also not purely a loss — HMR double-init is a *new* failure mode Svelte would otherwise introduce to the graph (a hot-replaced module leaves the old instance's `g.running` true, its `ResizeObserver` and `MutationObserver` attached, and both document-level keydown handlers registered). This strategy never introduces it. |

---

## 10. Effort estimate

| phase | what | days |
|---|---|---|
| 0a | Green baseline: conftest, `#reqBtn`, dead `.foot-missing` contract, boot `.catch` + id assertion, dead `catalog.js` code | 2.0 |
| 0b | **Extract inline scripts from all four `app/dev/*.html` harnesses** — the prerequisite for running the suite under the real CSP | 0.5 |
| 0c | **Author the e2e fixture corpus** — a `tests/fixtures/` source, a test-only `config.json`, an XSS-payload document and a dangling-link document. A design decision (what may appear in the product's own published docs), not hygiene. | 1.5 |
| 1 | Toolchain proof: package.json, vite.config, entry export surface, no-op island, committed bundle, `.gitattributes`, **two separate CI jobs**, three new Python tests, and the six doc corrections §1 requires in this commit | 2.0 |
| 2a | **Overlay contract**: `app/js/overlays.js`, `ensureOverlayHosts()`, migrate the four `el('graphOverlay').hidden` sites | 1.0 |
| 2b | `_file` gzip; dynamic `import()` split **including** the `app-shell.js:6` and `authoring.js:9-10` restructure and `coverage-load.js`; `?req=`/`?test=` to real query params | 3.0 |
| 3 | Drawer tree + search results (first real island), both `renderTree` call sites, the `/js/icons.js` seam, lock affordance | 3.5 |
| 4 | Reader satellites + `announce.js` + **the five-point article contract and `teardownMounted`** + the TOC `flushSync` | 3.0 |
| 5 | Auth screens | 4.0 |
| 6a | **Prerequisite:** Playwright net for coverage/runner (does not exist today) | 2.0 |
| 6b | Requirement tables, coverage overlay, report panel, runner chrome, the `store.js` listener bridge | 4.5 |
| 7a | **Prerequisite:** Playwright net for the map via `window.__graph` (does not exist today) | 1.5 |
| 7b | Map chrome, controller/chrome decoupling, `app/dev/graph-demo.html` port | 5.0 |
| 8 | Remaining documentation and requirements amendment | 1.5 |
| | **Total** | **35.0** |

Roughly half of Phase 7b is the controller/chrome decoupling — inverting a state machine that currently writes to buttons it built itself — not the Svelte part. Phases 6a and 7a are 3.5 days of writing tests for surfaces that have never had any; that is not overhead, it is the reason the later ports are safe. Phase 0c is 1.5 days because the alternative is a test suite whose "every e2e selector passes" guarantee has no net behind it.

### What could be cut

| cut | saves | what you lose |
|---|---|---|
| Phases 7a + 7b (map) | 6.5 | The chrome stays hand-rolled — but the map is the surface where Svelte buys least (~1,540 of ~2,300 lines are canvas that gains nothing). Cutting this is the most defensible cut on the list. Note it also cuts the `app/dev/graph-demo.html` port, which then stays valid. |
| Phases 6a + 6b (coverage/runner/req tables) | 6.5 | Keeps `pfControl.sync()`/`syncPill()`/`updateProgress()` and the clear-and-rebuild panel. Also loses the reactive `coverageStatus`, so badges keep needing a full `renderDoc` to recolour. **Phase 4's article contract is still worth landing** — it fixes a real `normalize()`-over-the-article overreach regardless. |
| Phase 2b | 3.0 | **Do not cut this.** It is the largest measured performance win in the plan and it is independent of Svelte. |
| Phase 2a | 1.0 | **Do not cut this.** It is a prerequisite for 2b and a correctness fix in its own right (three unguarded `el('graphOverlay').hidden` dereferences). |
| Phase 0 | 4.0 | **Do not cut this.** Cutting it makes every later failure unattributable and leaves the suite pointed at a corpus that does not exist. |
| Phase 8 | 1.5 | **Do not cut this.** The docs then assert claims the repository contradicts, which is worse than the constraint change itself. |

**Minimum defensible scope:** Phases 0, 1, 2, 3, 8 = **15.0 days.** That delivers the toolchain, both performance wins, the overlay contract, one proven island, six CI gates including the node-free clone test, a real fixture corpus, and honest documentation.

---

## 11. Explicit non-goals

1. **SvelteKit.** No `+page.svelte`, no `+layout.ts`, no adapter, no `ssr = false`, no `+server.ts`.
2. **Real path routing.** Hash routing stays. `serve.py` has no history fallback, every authored in-document link is synthesised as `#/<id>` at render time by `reader.js:175`, and all 14 Playwright tests navigate that way. (Worth recording: `grep '](#/' docs/` returns **zero** across the corpus — `#/` is a rendering convention, not an authoring one — so path routing would be *cheap* if it were ever wanted. It is still not wanted.)
3. **A Vite dev server, and therefore HMR.** `npm run dev` is `vite build --watch`, a file-writing process. No HMR websocket to collide with `connect-src 'self'`, no injected HMR client script, no dev-vs-prod CSP divergence, and no HMR double-init hazard on the canvas graph. Developers browse under the real production CSP at all times.
4. **The WYSIWYG editor.** `app/js/editor.js` and `app/js/editor/**` are not touched, with **one named exception**: two `destroyGroupChip` calls added to `editor/panels.js` and `editor/widgets.js` in Phase 5, so the chip adapter can be unmounted. **This non-goal does not cover `app/js/authoring.js`** — see §0.7 for that file's exact, bounded scope across Phases 2, 3 and 4.
5. **The CommonMark parser, the sanitizer, the highlighter, the block-renderer registry, the canvas graph engine, and every contenteditable.** ~4,550 lines, permanently plain modules, served natively at the same URLs. `/js/commonmark.js` stays literally fetchable and `tests/test_conformance.py` keeps measuring the real parser.
6. **A mass `.js` → `.ts` rename.** `checkJs: true` over the existing JSDoc only.
7. **Retiring the `app` service registry or the mutable `state` object wholesale.** They retire surface by surface, only when both ends of a given entry are components. `app-shell.js` survives this plan, gaining only a ~10-line change emitter and losing one static import.
8. **Modernising the boot sequence.** `main.js` stays a vanilla awaited function with its eleven ordering constraints. The `.catch` and the id assertion in Phase 0 are bug fixes, not a redesign.
9. **Path-scoped `immutable` caching.** The bundle has a fixed filename; there is nothing to cache-bust and no possibility of a stale hashed asset outliving a permission change.
10. **Fixing the map's keyboard inaccessibility, the DPR-change repaint gap, or `#treeList`'s half-implemented `role="tree"`.** All real defects. Fixing them inside a port makes the diff unreviewable. Note them, ship behaviour-identical, fix them after.
11. **Adding a focus trap to the drawer.** There is none today. Adding one is new behaviour, not a port. (The existing *focus restore* at `main.js:98/100/110` is a different thing and is preserved — `setupDrawer` stays vanilla precisely so it cannot be lost.)
12. **Bundling `app/thirdpartyrenderer/**`.** The bring-your-own-library contract survives byte-for-byte. Two tripwires plus lint exist purely to make sure nobody accidentally changes this — the previously listed `@vite-ignore` comment was a no-op under this strategy and has been dropped rather than counted.
13. **Serving `app/svelte/**` differently, or moving `app/data/`.** Both stay where they are and stay world-readable under `APP_DIR`, knowingly (§9). Nothing private may be placed in either.

---

# Part II — TypeScript

## TypeScript: the decision

WebDocs adopts TypeScript. The decision is already taken; this section states the *cost model*, because the cost model determines the ordering of everything below it.

**Browsers cannot execute `.ts`.** There is no runtime, no polyfill, and no server-side shim in this project — `serve.py` serves files under `APP_DIR` (hardcoded at `serve.py:39`) by extension-agnostic path join with no transform step. So real `.ts` syntax requires a compiler, and a compiler requires a build step. Today `app/index.html:81` carries `<script type="module" src="/js/main.js">` and the browser resolves the native ES module graph; that property dies with the first `.ts` file.

**The bundler is the cost, and it is already being paid.** The Svelte 5 decision introduces Vite regardless. Once Vite exists, `.ts` is a file extension and a `lang="ts"` attribute — near-free. That is the honest case for TypeScript here.

**The one thing `.ts` is NOT free of.** It is not free of the type *design* work. Enumerating the 81 undeclared properties on `GraphContext` (`app/js/graph.js:78`), deciding whether `Doc` is a `DocStub | LoadedDoc` union, choosing whether the markdown parser's `MdBlockNode` becomes a real discriminated union — that intellectual labour is identical whether the output is `@property` lines or interface members. The syntax is free after Vite; the thinking never is.

### The option that exists today, and why we are not taking it as the endpoint

The project could have **full static type safety with zero build step, this week**. A `tsconfig.json` with `allowJs: true`, `checkJs: true`, `noEmit: true` type-checks the 1,577 JSDoc tags already in `app/js/` and emits nothing. `app/index.html` is unchanged, `serve.py` serves identical bytes, and the whole thing reverts by deleting two files.

That option is not a curiosity — **it is phase one of this plan**, and it remains a complete, standalone fallback. If the Svelte decision were ever reversed, the work in rungs 0–2 below stands on its own: a fully type-checked JavaScript codebase with no build step, no bundler, and no third-party runtime dependency. Nothing in rungs 0–2 is wasted in that scenario, and nothing in rungs 0–2 depends on Vite existing.

### The position

**Decouple the type-checking from the syntax conversion, and do the type-checking first.**

- Type-checking (rungs 0–2) lands **before** the first `.svelte` file exists. It is `noEmit`, so zero runtime bytes change.
- Syntax conversion (rung 3) lands **after** Vite, and **rides inside Svelte PRs per surface** — never as a standalone "convert everything to `.ts`" project.
- Full `strict` (rung 4) lands **after** the component migration, because ~186 of the expensive null-safety decisions live in imperative DOM-building modules that Svelte deletes.

The argument is diagnostic separability. You are about to refactor 12,528 lines. A type-checker that is green *before* the refactor makes every red in a component PR unambiguously that PR's fault. If the checker arrives after, its first 581 errors are indistinguishable from migration damage and each one has to be individually triaged as "was this always broken, or did I just break it?"

Two supporting facts, both measured, both from in-flight work on this branch:

1. `app/js/editor/serialize.js:79` contains a regex literal with a raw U+000A inside a character class. It is a hard `SyntaxError` — the WYSIWYG Markdown serialiser cannot load in a browser on `feature/svelte-uplift` right now. `node --check` returns 0 on the file and does not catch it.
2. The JSDoc block at `app/js/editor/serialize.js:73-77` was copy-pasted from the neighbouring `inFence(ranges, pos)` and now sits above `codeSpanRanges(body)`, declaring `@param ranges`, `@param pos` and `@returns {boolean}` on a function taking `body` and returning `[number, number][]`.

Neither is caught by anything the project owns. Both are caught in the first two seconds of `tsc --noEmit`. The value is not the one-time cleanup — it is that this class of rot stops accumulating while 18 files are in flight.

---

## TypeScript: what the codebase already gives us

### Inventory (measured)

| Metric | Value |
| --- | --- |
| Hand-written modules under `app/js/` | 53 |
| Lines | 12,528 |
| JSDoc tags (`@param`/`@returns`/`@type`/`@typedef`/`@property`/`@callback`/`@template`) | 1,577 |
| `@typedef` declarations | 175 real definitions across 45 files |
| Cross-file type aliases (`{import('./catalog.js').Doc}`) | 86, forming 63 file-to-file type edges |
| Files with zero JSDoc type tags | 2 — `app/js/html.js`, `app/js/icons.js` |
| `@ts-check` / `@ts-ignore` / `@ts-expect-error` pragmas | 0 |

Densest by `@typedef` count: `app/js/editor/serialize.js` (13), `app/js/editor.js` (12), `app/js/coverage.js` (12), `app/js/graph.js` (9), `app/js/requirements/parse.js` (8), `app/js/main.js` (8), `app/js/graph/layout.js` (8).

Highest type-import fan-in: `app/js/requirements.js` (11 importers), `app/js/catalog.js` (9), `app/js/coverage.js` (8). Those three account for 28 of the 63 type edges — **they are already the shared types module, just co-located with runtime code.**

### Error counts by strictness rung

All figures **MEASURED** with TypeScript 5.9.3, `target: ES2022`, `lib: ES2022 + DOM + DOM.Iterable`, `moduleResolution: Bundler`, `skipLibCheck: true`, against a scratch mirror of `app/js/` with only the `serialize.js:79` regex repaired so the program parses. No repository file was modified.

| Rung | Flags | Errors | Note |
| --- | --- | --- | --- |
| 0 — Parses | none (TS1xxx only) | 1 real, ~240 cascaded | The `serialize.js:79` regex; tsc parses `.js` with JSX enabled, so one broken regex cascades TS1381/TS1382/TS17008 |
| 1 — Checked | `checkJs`, `strict: false` | **581** | MEASURED |
| 2 — No implicit any | `+ noImplicitAny` | **+349** | MEASURED (TS7006 191, TS7005 77, TS7034 42, TS7053 36, plus 7019/7022) |
| 4 — Full strict | `strict: true` | **1,363 total** | MEASURED. Delta from rung 1 is +782: 349 implicit-any, 186 strictNullChecks-family, ~247 spillover TS2339/TS2345 once inference tightens |

### The distribution is pathological, not diffuse

581 errors over 12,528 lines reads as 1 per 21 lines. That is misleading. The real shape:

- **502 of 581** are TS2339 (property does not exist).
- **321 of those 502** are the single string `does not exist on type 'GraphContext'` — **55% of the entire loose backlog from one typedef.**
- **78** more are `on type 'HTMLElement'`, all downstream of `export const el = id => document.getElementById(id)` at `app/js/app-shell.js:32` (55 `.value`, 14 `.disabled`, 5 `.checked`, 2 `.placeholder`, 1 `.rows`, 1 `.getContext`).
- **92** are from `elem()`'s flat `@returns {HTMLElement}` at `app/js/dom.js:36` across 398 call sites.

**MEASURED payoff of fixing `GraphContext` alone** (via a permissive `Record<string, any>` substitution, which is an *upper* bound on the mechanical effect): strict:false 581 → 242; strict:true 1363 → 911. A properly enumerated typedef will surface genuine errors the permissive version masked — **ESTIMATED real landing zone 260–300, not exactly 242.** Do not quote 58% as exact.

### Fifteen files are already clean

Eight pass **full `strict`** untouched: `app/js/commonmark.js`, `app/js/graph/util.js`, `app/js/highlight/grammars.js`, `app/js/highlight/lexer.js`, `app/js/icons.js`, `app/js/md/blockpost.js`, `app/js/md/patterns.js`, `app/js/md/scan.js`. Fifteen pass at `strict: false`.

Note the distinction: `icons.js` is clean **by absence** — it has no JSDoc at all. The `md/*` and `highlight/*` modules are clean **by quality** — pure functions over strings with accurate annotations. That distinction matters for the include-list ratchet in rung 1.

### What this means for effort

The JSDoc is accurate where it is old and drifting where it is new, because nothing has ever checked it. `app/js/requirements/parse.js` declares `@property {'req'} kind` and `@property {'test'} kind` with a real discriminated union at line 65 — exactly what you would hand-write in TypeScript. `app/js/catalog.js`'s `Doc` typedef, the shape almost everything in the app is keyed on, produces **zero** property errors anywhere in the codebase.

This is accurate documentation with one god-object hole in it, plus the ordinary DOM-narrowing tax every browser codebase pays on first contact with `checkJs`. That is an unusually good starting position, and it is why the type-design work transfers 100% to `.ts`.

### Check speed (measured)

Cold full run 1.24–1.31 s wall clock (tsc `--extendedDiagnostics`: Parse 0.14 s, Bind 0.07 s, Check 0.55 s). Full `strict` 1.42 s. `skipLibCheck: false` costs +0.35 s and buys nothing. With `incremental: true`, a no-op re-run is 0.76 s. 122 MB peak RSS. **The check is never the reason CI is slow, and there is no argument for a watch mode.**

---

## TypeScript: configuration

### Phase 0 — `tsconfig.json` (no build step, `noEmit`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],

    "allowJs": true,
    "checkJs": true,
    "noEmit": true,

    "skipLibCheck": true,
    "types": [],

    "strict": false,

    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": [
    "app/js/commonmark.js",
    "app/js/graph/util.js",
    "app/js/highlight/grammars.js",
    "app/js/highlight/lexer.js",
    "app/js/icons.js",
    "app/js/md/blockpost.js",
    "app/js/md/patterns.js",
    "app/js/md/scan.js"
  ],
  "exclude": ["app/thirdpartyrenderer/**", "node_modules"]
}
```

The `include` list starts narrow **on purpose** — see the ratchet below. It widens per PR until it is `["app/js/**/*.js"]`.

### Phase 0 — `package.json` (the whole thing)

```json
{
  "name": "webdoc",
  "private": true,
  "type": "module",
  "scripts": { "check": "tsc --noEmit" },
  "devDependencies": { "typescript": "~5.9.3" }
}
```

### Non-obvious options

| Option | Why |
| --- | --- |
| `allowJs` + `checkJs` + `noEmit` | The whole trick. tsc reads the 1,577 existing JSDoc tags and emits nothing. `app/index.html:81` keeps its `<script type="module" src="/js/main.js">`, `serve.py` serves identical bytes, and the phase reverts by deleting two files. |
| `moduleResolution: "Bundler"` | Chosen over `NodeNext` because it accepts the extension-ful specifiers the browser requires (`"./catalog.js"`) without ESM/CJS ceremony, and it is what Vite will want later — so resolution semantics do not change under us when the bundler arrives. MEASURED: all 86 cross-file `{import('./catalog.js').Doc}` aliases resolve with zero extra config. |
| `types: []` | Stops tsc auto-including every `@types/*` in `node_modules`. Inert today with only `typescript` installed; the day someone adds `@types/node` it stops Node globals from silently type-checking browser code that has no access to them. |
| `skipLibCheck: true` | MEASURED at +0.35 s with it off, and it buys nothing — we own no `.d.ts` files yet. |
| `strict: false` | Deliberate. Rung 1 of a ladder, not the destination. |
| `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch` | Not part of `strict`, and free. **This is why this plan adds no ESLint** — see the tooling section. |
| `~5.9.3` pin (not `^`, never `latest`) | Load-bearing. See below. |

### The TypeScript version pin is load-bearing

`typescript@latest` is **7.0.2** (the native Go port). MEASURED: it rejects the Closure-style JSDoc function type at `app/js/blocks.js:46` with TS1003, and — verified by control experiment — **that single parse error suppresses ALL semantic diagnostics program-wide.** One error reported for 53 files; an appended `export const x = totallyUndefined;` in `catalog.js` produced no error at all.

Piloting on TS 7 gives a green build that checked nothing. After rewriting the 13 Closure-style typedefs in `app/js/blocks.js` and `app/js/map-view.js` to arrow form (step 8), TS 7.0.2 reports 570 loose errors — consistent with 5.9.3's 581, confirming both the numbers and the suppression.

**Mitigation, and make it a CI smoke test:** pin `~5.9.3`, and in the first CI commit deliberately introduce a reference to an undefined identifier and assert tsc reports it. Separately, `svelte-check@4.7.6` declares peer `typescript: "^5.0.0 || ^6.0.0"` — so the pin outlives the JSDoc fix anyway. Re-run `npm view svelte-check peerDependencies` at implementation time; it is the number most likely to have moved.

### Vite-phase `tsconfig.json` (the moment the first `.ts` file exists)

```json
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "svelte"],

    "allowJs": true,
    "checkJs": false,
    "strict": true,

    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,

    "noUncheckedIndexedAccess": false,
    "exactOptionalPropertyTypes": false,

    "isolatedModules": true,
    "verbatimModuleSyntax": true,

    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,

    "baseUrl": ".",
    "paths": { "$lib/*": ["src/lib/*"] }
  },
  "include": [
    "src/**/*.ts",
    "src/**/*.js",
    "src/**/*.svelte",
    "src/**/*.d.ts",
    "vite.config.ts",
    "svelte.config.js"
  ],
  "exclude": ["node_modules", "app", "app/dev", "app/thirdpartyrenderer"]
}
```

**The `checkJs: false` flip is deliberate and is not "throwing the JSDoc away."** With `checkJs: false`, tsc still *parses* JSDoc in `.js` files and uses it for inference when a `.ts` file imports from them. So the rung-1 and rung-2 JSDoc work keeps feeding types to the converted frontier for free, while the `.ts` frontier is `strict: true` **from its very first file** rather than inheriting a `strict: false` rung and dragging a global flag up across a half-migrated tree.

The `.js` under `app/js/` that has not yet been converted is checked by the *phase-0* tsconfig, which stays in place until the last module moves. The two configs coexist: `tsconfig.json` (new, `src/`, strict, `.ts`) and `tsconfig.legacy.json` (the phase-0 file, `app/js/`, `checkJs`, `strict: false`), both run in CI, and the legacy one shrinks as files migrate out.

### The strictness ladder

| Rung | Flags added | Baseline | Exit criterion | Cost |
| --- | --- | --- | --- | --- |
| **0 — Parses** | none | 1 real / ~240 cascaded | Zero TS1xxx syntax diagnostics | minutes |
| **1 — Checked** | `allowJs`, `checkJs`, `noEmit`, the four free flags | 581 (MEASURED) | `include` = `["app/js/**/*.js"]` **AND** zero errors | ~5 days |
| **2 — No implicit any** | `noImplicitAny` only (not full strict) | +349 (MEASURED) | Zero errors with `noImplicitAny` on | ~1.5 days |
| **3 — TS syntax** | `verbatimModuleSyntax`, `isolatedModules` (no new *checking* flags) | n/a | No `.js` remaining in a converted surface, per surface | ~1 day of codemod spread across Svelte PRs |
| **4 — Full strict** | `strictNullChecks` and the rest | ~186 nullability + ~247 spillover, minus what Svelte deleted | `strict: true` at top level, no per-file exemptions | ~4–5 days at rung-2 scope; materially less after Svelte |
| **5 — DECLINED** | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | unmeasured | — | — |

**Every exit criterion is "zero errors", never "fewer errors."** A non-zero baseline cannot be gated in CI, and an ungated check decays to zero value within weeks.

### The include-list ratchet

This is the single most important mechanism in the plan and it is worth stating separately.

Ship the phase-0 tsconfig with `include` listing **only the 8 already-strict-clean files**, and wire `npx tsc --noEmit` into CI in the same commit. CI is **green and gating from commit two**. Every subsequent step widens the `include` list rather than chipping at an unenforceable 581-error baseline.

The consequence that matters: **an abandoned run still leaves CI enforcing whatever was completed.** If this work stalls at day four with `GraphContext` fixed and `dom.js` untouched, the artifact is a partially type-checked JS codebase with no build step and a gating CI check — strictly better than the status quo. That is the design's answer to its own biggest risk.

### Recommended end state, and the justification

**`strict: true`, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` permanently declined.**

`strict: true` is the destination because it is the only setting that is not a negotiation — every per-file exemption is a place where the next reader has to ask which rules apply.

`noUncheckedIndexedAccess` is declined on evidence about *this* codebase, not on general principle. `app/js/md/inline.js`, `app/js/md/blocks.js` and `app/js/highlight/lexer.js` are character-scanning loops where every `src[i]` becomes `string | undefined`. Turning it on would add hundreds of guards to code that is already strict-clean and well-tested, for a bug class the parsers' own bounds logic already covers — and the guards would obscure the algorithms. `exactOptionalPropertyTypes` fights the `{...opts}` merge style used throughout `app/js/graph/`. Neither is part of `strict`. **This figure is unmeasured** — if someone wants them, measure first; I would expect a large number.

---

## TypeScript: the type model

### Layout (post-Vite, `src/lib/types/`)

| File | Contents |
| --- | --- |
| `index.ts` | Barrel re-export |
| `primitives.ts` | `Point`, `Size`, `Rect`, `ViewTransform`, branded `HtmlString` / `MarkdownString` |
| `doc.ts` | `DocId`, `Doc`, `DocStub`, `LoadedDoc`, `DocSummary`, `DocRef`, `DocMeta`, `AccessBlock`, `SourceConfig`, `SiteConfig` |
| `requirements.ts` | `RequirementEntry`, `TestCaseEntry`, `TestStep`, `ReqGroupBlock`, `TestCaseDocBlock`, `ReqOrTestBlock` |
| `coverage.ts` | `CoverageState` union, `CoverageStatus`, `CoverageResults`, `AutoResultEntry`, `AutoTestRef`, `AutoTestCatalogEntry`, `AutoStore`, `TestEvidence`, `ManualTestEntry`, `RecordedStep` |
| `runs.ts` | `TestRunMeta`, `TestRunRecord`, `LegacyTestRunRecord`, `RunnerOpts` |
| `auth.ts` | `AuthPolicy`, `GroupSpec`, `CurrentUser`, `DocAccess`, `AuthState`, `AuthResult<T>`, `RestrictedError`, `RestrictedDetail` |
| `graph.ts` | `GraphInputNode`, `GraphDocNode`, `GraphModel`, `DocEdgeRef`, `ExternalLinkNode`, `DocLinksResult`, `ConnectionType`, `GraphOptions`, `GraphHandle` |
| `editor.ts` | `BlockKind` union, `RichBlock<T>`, `TableBlock`, `ReqBlock`, `TestCaseBlock`, `RequirementRow`, `ReqRef`, `MdSourceBlock` |
| `wire/{site,index,auth,tests}.ts` | Server JSON contracts — see below |

### The pre-Vite form of the same module

Before Vite exists, this is `app/js/types.js`: a plain `.js` file containing only `@typedef` blocks plus `export {}`. Same admission rule, same contents, same duplicate reconciliation. It becomes `src/lib/types/*.ts` at rung 3 by mechanical split.

### Admission rule

**A type enters the shared module only if 2+ modules name it, OR it crosses the wire.** Everything else stays module-private.

That means all 13 markdown-parser internals stay in `src/lib/markdown/` as local interfaces (`MdBlockNode`, `ParsedDocument`, `RefDefinition`, `RefDefParse`, `InlinePiece`, `TrimmedUrl`, `AutolinkResult`, `DelimRunScan`, `LineIndent`, `LinkDestScan`, `LinkTitleScan`, `BracketLabelScan`, `TableBuildInfo`). Same for `app/js/dom.js`'s `Child`/`ElemProps`, `app/js/panzoom.js`'s `PanZoomOptions`/`NaturalSize`, and the runner's working state (`RunStep`, `RunTest`).

This is not tidiness — a flat namespace would turn the **three unrelated meanings of "Block"** into real collisions: `app/js/editor.js:73` `Block` (WYSIWYG UI block), `app/js/md/blocks.js:26` `MdBlockNode` (CommonMark parse node), `app/js/blocks.js:34` `BlockRenderContext` (fenced-code renderer registry). There are also **two files named `blocks.js`** (`app/js/blocks.js` and `app/js/md/blocks.js`).

### A third tier: do not invest here

`AppState` and `AppRegistry` (`app/js/app-shell.js:18`, `:118-130`), `CovContext` (`app/js/coverage-view.js:37`), `DocMapState` (`app/js/map-view.js:38-49`), `DrawerHandle` and `IndexOverlayHandle` (`app/js/main.js:26`, `:50`), `NewDocModalOpts` (`app/js/authoring.js:26`), `ConfirmDialogOptions` (`app/js/editor/panels.js:216`).

These exist **only because vanilla JS has no component model.** `export const app = {}` with nine optional members is a service locator whose own comment (`app-shell.js:115-118`) says it exists to keep the feature modules acyclic; under Svelte it becomes `setContext` or a runes store. Add the one missing member and otherwise leave them alone.

### Duplicate typedefs to reconcile — named

| # | Duplicate | Sites | Resolution |
| --- | --- | --- | --- |
| 1 | `DocEdgeRef` declared twice, identically, as `{from, to}` | `app/js/doclinks.js:20` and `app/js/requirements.js:80` — and `requirements.js:77` admits it in prose | One definition in `types/graph.ts`. `app/js/graph.js:28` currently imports it from `requirements.js` while `graph.js:29` imports `ExternalLinkNode` from `doclinks.js` — one consumer pulling two halves of one concept from two owners. |
| 2 | `GraphContext` names **two disjoint types with zero overlapping properties** | `app/js/graph.js:78` (internal mutable pipeline bag) and `app/js/map-view.js:20` (the public handle `createGraph` returns) | Rename to `GraphInternals` (private to `src/lib/graph/`) and `GraphHandle` (exported). Four modules — `graph/chrome.js:9`, `graph/interactions.js:8`, `graph/render.js:11`, `graph/view.js:9` — import the `graph.js` meaning. File-local JSDoc today, so nothing breaks; a duplicate-identifier error the moment either becomes an exported TS interface. |
| 2b | **A live defect**: the handle is declared a *third* time, inline, and the declarations disagree | `app/js/graph.js:107-120` says `focus: (id) => boolean` and `search: (q) => string\|null`; `app/js/map-view.js` says both are `function(string): void` | The consumer's own type silently discards two return values. Declare `GraphHandle` once, annotate `createGraph` with it, delete the inline `@returns`. |
| 3 | `GraphModel` declares its edge/node arrays inline despite `DocEdgeRef`/`ExternalLinkNode` existing | `app/js/map-view.js:78`, `:79`, `:80`; a fifth inline `{from, to}` at `app/js/graph/render.js:532` | `{from, to}` exists 5 times: 2 typedefs + 3 inline. One `DocEdgeRef`. |
| 4 | The recorded-step row `{step, response, pass}` declared inline and identically twice | `app/js/coverage.js:97` (`ManualTestEntry.steps`) and `app/js/runner.js:56` (`TestRunRecord.steps`) | Name it `RecordedStep` in `types/coverage.ts`. `runner.js` writes it, `coverage.js` reads it, and there is no shared name today. |
| 5 | The editor block union declared twice, member-for-member — **eight typedefs collapse to four** | `app/js/editor.js:73` (`Block`) and `app/js/editor/serialize.js:124` (`MdSourceBlock`). Six of ten members are literally the same; four are clones differing in one field: `HeadingBlock{type,level,html}` vs `HeadingMdBlock{type,level,text}`, and the same for Paragraph, Quote, List | `RichBlock<HtmlString>` / `RichBlock<MarkdownString>` over branded strings. **This is `.ts`-phase work by necessity** — brands are unwritable in JSDoc — so it slots into rung 3, not rung 1. |
| 6 | A test case exists in **five incompatible shapes** with no declared relationship | `TestCaseEntry` (`requirements.js:65`), `TestCaseBlock` (`editor/widgets.js:139`), `TestCaseDocBlock` (`requirements/parse.js:52`), `RunTest` (`runner.js:30`), `TestRunRecord` (`runner.js:51`) | Declare the relationships explicitly with `extends` where they are subsets. Do not force them into one type — they are genuinely different lifecycle stages. |
| 7 | **Discriminant key mismatch**: `ReqBlock` (`editor/widgets.js:75`) keys on `type`; `ReqGroupBlock` (`requirements/parse.js:40`) keys on `kind` | Two discriminated unions in one app keyed on different property names | Standardise on `kind`. `type` is the riskier key — these block objects get spread into element props, where `type` collides with `HTMLInputElement.type`. Only read in switch statements, so it is a mechanical pass. |
| 8 | **Silent serialization boundary**: `RequirementRow.traceTo` (`editor/widgets.js:66`) is a comma-joined `string` (`'sys_2, sys_3'`); `RequirementEntry.traceTo` (`requirements.js:49`) is `string[]` | Same concept, different representation, no named conversion function | Name the boundary function. Not a type annotation — a small refactor. |
| 9 | Five "slim doc reference" shapes, two identical | `DocPickerEntry` (`editor/panels.js:12`) and `EditorOpts.allDocs` (`editor.js:83`, inline) are the same `{id, title}`. Plus `TreeDoc` (`tree.js:11`), `GraphDocNode` (`map-view.js:58`), `DocRef` (`requirements/parse.js:14`) | `editor/panels.js:13` already admits in prose that "only id and title are read here, out of the fuller `GraphDocNode` shape". One `DocSummary`. |
| 10 | Anonymous high-frequency shapes | `{tx, ty, k}` inline **4 times** (`graph.js:68`, `graph.js:115`, `map-view.js:28`, `map-view.js:42`); `{x, y}` inline **8 times** (`graph/render.js:162,400,541`, `graph/util.js:64`, `graph.js:69,119,241`, `map-view.js:32`) | `ViewTransform` and `Point` in `types/primitives.ts`. |
| 11 | Subset expressible as `extends` | `AutoTestCatalogEntry` (`coverage.js:29`) is a strict superset of `AutoTestRef` (`coverage.js:42`) | `interface AutoTestCatalogEntry extends AutoTestRef`. Inexpressible with `@typedef {Object}`, which synthesises an anonymous type alias that cannot be extended — one of the concrete reasons rung 3 exists. |

**Not duplicates, but confusingly named — keep both, rename one:** `GraphModel` (`map-view.js:71`, server-fetched view model) vs `GraphBuildModel` (`graph/layout.js:33`, internal layout model); `ReqRef` (`editor/widgets.js:82`) vs `ReqRefContext` (`requirements/parse.js:34`).

**One definition, two import paths:** `TestStep` is defined at `app/js/editor/widgets.js:133` and re-exported as an alias by `app/js/requirements.js:37`. `coverage-report.js:18` and `report.js:21` import it from `./requirements.js`; `requirements/render.js:16` imports it from `../editor/widgets.js`. A pure domain type living inside an editor-widget module.

### Type-only import cycles — three, all dissolved for free

1. `app/js/requirements.js:35` ← → `app/js/requirements/parse.js:11-12`
2. `app/js/coverage.js:14` → `app/js/runner.js:17` → `app/js/main.js:23` → `app/js/coverage.js`
3. `app/js/md/blockpost.js:9` ← → `app/js/md/blocks.js:63`

None is a *runtime* cycle, and TypeScript tolerates type cycles without error — so these are not a compile blocker. Cycle 2 is the pathological one: `RunnerOpts`, which is `runner.js`'s **own** options bag, is defined at `main.js:60`. The leaf module's parameter type is owned by the app entry point.

**Hoisting `RunnerOpts`, `TestRunRecord`, `RequirementEntry`/`TestCaseEntry` and `ReqOrTestBlock` into the types module dissolves all three with no code motion.**

There is exactly one **runtime** cycle in the tree: `app/js/md/blocks.js` ← → `app/js/md/tables.js`. ESM tolerates it and Vite will too, but `isolatedModules` at rung 3 is what stops any *type* edge from silently becoming a runtime module-init edge.

### Server JSON contracts vs client view models — separate them

**Yes, a separate `types/wire/` namespace, consumed as `import type * as Wire from '$lib/types/wire'`.** Three grounded reasons:

1. **The client already reshapes at the boundary**, and that fact is currently recorded only in prose. `app/js/search.js:8-11` says the wire is `{results: [{id, title, snippet}]}` and `searchDocs` "unwraps results and renames id to docId". `app/js/map-view.js:73` says `fetchGraphModel` reshapes "the server's compact node/edge-tuple response into named collections". `app/js/requirements.js:86-89` says the server now computes composed ids the client used to build.
2. **`serve.py` is Python stdlib-only with no shared schema**, so every wire type is an unverified assertion about another process. `types/wire/` is the natural place to hang one parse/guard per endpoint family; mixing them into `types/graph.ts` hides that they are unchecked.
3. `GraphModel` vs `GraphBuildModel`, and `TreeDoc` vs `Doc` vs `GraphDocNode`, **are** the wire/view-model confusion showing through.

**Endpoints needing a `Wire` type:** `/site.json`, `/api/index/{status,tree,search,graph,coverage,resolve,access}`, `/api/auth/{me,users}`, `/api/tests/<source>`, `/api/auto/<source>`, `/api/xml/<source>`, `/docs/*`.

**The pragmatic exception:** several types are genuinely identical on both sides today — `TreeLevel`, `IndexStatus`, `AuthPolicy`, `CurrentUser`, `GroupSpec`, `DocAccess`, `AutoStore`, `TestRunRecord`. Define those **once** in `types/wire/` and re-export a one-line alias from the domain file (`export type TreeLevel = Wire.TreeLevel`). The alias documents "we pass this through unchanged" and becomes a real, reviewable edit the day the client diverges — rather than silent drift.

### The highest-value missing type

**The `/api/index/graph` wire payload has no typedef at all.** `app/js/map-view.js:97-116` decodes positional tuples by index: node tuples are `[id, title, description, flags, groupIndexes]` with flags bit 0 = locked and bit 1 = ownsAccess; edge tuples are `[from, to, type]` with `e[2] === 0` meaning prereq. Entirely untyped and index-based.

Related and provably wrong: `fetchGraphModel` produces docs with **8** fields (`id`, `title`, `description`, `assumes`, `next`, `locked`, `ownsAccess`, `groups`) but `GraphDocNode` (`map-view.js:58`) declares **5** — and `app/js/graph/layout.js:152-153` reads `d.groups` and `d.locked`.

### Two design fixes that must be named

**`RestrictedError`** replaces the `err.restricted = true` monkey-patch at `app/js/catalog.js:147`. The current code does `const err = new Error('Restricted: ' + doc.id); err.restricted = true; err.detail = detail;` and consumes it at `app/js/main.js:186` as `if (e && e.restricted)`. Both ends fail: `Error` has no such property, and in a `catch (e)` block `e` is `unknown` under `strict`. Declare a real subclass **plus** a structural predicate:

```ts
export class RestrictedError extends Error {
  readonly restricted = true as const;
  constructor(readonly docId: string, readonly detail: RestrictedDetail) {
    super('Restricted: ' + docId);
    this.name = 'RestrictedError';
  }
}
export function looksRestricted(
  e: unknown
): e is Error & { restricted: true; detail: RestrictedDetail } {
  return e instanceof Error && (e as { restricted?: unknown }).restricted === true;
}
```

Catch with the **structural predicate**, not `instanceof` — the class is the ergonomic constructor, the predicate is what survives bundler dedup, HMR module re-instantiation, and any future worker/realm boundary, all of which break `instanceof` across a Vite build.

**Collapsing the eight editor block typedefs** into `RichBlock<HtmlString>` / `RichBlock<MarkdownString>`. `app/js/editor.js`'s `onSave` converts the four inline-HTML block types to Markdown via `htmlToMd` before calling `serializeDoc`, but both sides are bare `string`, so nothing stops unconverted HTML reaching the Markdown serialiser — exactly the bug class a hand-rolled sanitizer/serializer pair is most exposed to. Branded strings are unwritable in JSDoc, so **this is rung-3 work by necessity.**

---

## TypeScript: hostile patterns and their fixes

These are the patterns TypeScript rejects, ordered by measured error mass. The three load-bearing conversions — `dom.js`, `html.js`, `app-shell.js` — are treated separately below the table, with an important scope correction on the first two.

| Pattern | File | Why TS objects | Fix |
| --- | --- | --- | --- |
| God-object created bare, then ~100 properties bolted on by five sibling modules: `const g = { container: container, opts: opts };` | `app/js/graph.js:124`, mutated across `graph/layout.js`, `graph/render.js`, `graph/view.js`, `graph/chrome.js`, `graph/interactions.js` | TS infers the literal type `{container: HTMLElement; opts: GraphOptions}` and treats every later assignment as an excess property. **MEASURED: 113 strict errors inside `graph.js` alone**, which is why it jumps from 12 loose to 143 strict | Annotate the construction site: `/** @type {GraphContext} */ const g = ...`. Ideally decompose as `@typedef {GraphCore & GraphRenderState & GraphChromeRefs & GraphInteractionState} GraphContext` so each sibling extends only its own slice. **Do NOT paper over it with an index signature** — that discards exactly the safety this buys |
| Deliberately partial `@typedef` over a mutable shared object — 19 `@property` lines while the code reads 81 more. Self-labelled at `graph.js:76`: "Far larger than listed here" | `app/js/graph.js:78` | A partial typedef is not a partial contract — it is a **closed object type**. Every undeclared field is TS2339. **MEASURED: 321 of 502 loose TS2339s (64%)** | Enumerate the full shape. MEASURED payoff (upper bound via permissive substitution): 581 → 242 loose, 1363 → 911 strict |
| Two disjoint typedefs named `GraphContext`, plus a third inline declaration that **disagrees** with the second | `app/js/graph.js:78`, `app/js/map-view.js:20`, `app/js/graph.js:107-120` | File-local under checkJs today; a duplicate-identifier error the moment either is an exported TS interface. And the inline `@returns` types `focus` as `boolean` while the consumer says `void` — two return values silently discarded | Rename to `GraphInternals` / `GraphHandle`, declare the handle once, delete the inline `@returns` |
| Event listener parameters annotated `@param {Event}`, then read for pointer/keyboard specifics | `app/js/graph/interactions.js`, `app/js/graph/chrome.js`, `app/js/panzoom.js` | **MEASURED: 23 TS2339** — `clientX` (6), `clientY` (6), `key` (5), `pointerId` (2), `detail` (2), `deltaY`, `button`. The explicit tag **overrides** `addEventListener`'s contextual typing, making it actively worse than no annotation | Usually just **delete** the `@param {Event}` and let contextual typing supply `MouseEvent`/`KeyboardEvent`/`PointerEvent`/`WheelEvent`. Where the handler is stored in a variable for teardown (which `interactions.js` does), annotate at the declaration instead |
| Stale discriminated union — `blockToMd()` switches on `'access-start'` (`:219`) and `'access-end'` (`:225`), neither in the ten-member union | `app/js/editor/serialize.js:124` | TS2678 not-comparable, then TS2339 "Property 'read' does not exist on type `never`" as narrowing collapses. The blocks are genuinely constructed at `:294` and `:446` — **the type is wrong and the code is right** | Add `AccessStartBlock` / `AccessEndBlock` to the union. Same drift in `app/js/editor.js:73`'s `Block`. Follow the pattern `app/js/requirements/parse.js:65` already gets right |
| Untyped `await res.json()` into a `{}`-initialised variable: `let body = {}; body = await res.json(); ... body.csrf` | `app/js/auth.js:183-189`; 16 `.json()` sites, 15 `fetch()` sites across 10 modules | The `{}` initializer pins the type and never widens. **MEASURED: 13 of `auth.js`'s 48 strict errors** | Declare per-endpoint response types in `types/wire/`, one `getJson<T>(url)` helper so the assertion happens once instead of 16 times |
| Result-union fields read unguarded off `Object.assign({ok:true}, body)` / `Object.assign({ok:false, error}, body)` | `app/js/auth.js:187`; read at `app/js/authoring.js:290`, `:291`, `app/js/auth-ui.js:101`, `:103` | **These four are the ONLY places in the entire codebase where checkJs finds a genuinely wrong property read on a data object** rather than on a late-bound registry. That concentration is a signal about where the real risk lives | Discriminated `AuthResult<T> = ({ok: true} & T) \| {ok: false; error: string}`. Callers must write `if (!r.ok) { show(r.error); return; }` — which is what the code already means to do |
| Evolving-any accumulators: `const out = []`, `let body = {}`, `new Map()` with no type argument | `app/js/graph/layout.js:158,160`; `app/js/blocks.js:66`; ~52 declarations tree-wide | Invisible at rung 1, appears all at once at rung 2 as TS7034 (42) + TS7005 (77). **MEASURED: this is why `graph/layout.js` goes from 1 error to 45** — its 8 typedefs are accurate; the file simply never annotates lambdas | Annotate at declaration. Replace `(auto[id] = auto[id] \|\| []).push(x)` with `(auto[id] ??= []).push(x)` — same semantics, and it type-checks where the old form does not |
| Index writes on `{}` accumulators: `autoLinks[id] = ...`, `for (const id in store.links)` | `app/js/coverage.js:124,140,142`; `app/js/coverage-view.js:113-115` | **MEASURED: 36 TS7053.** `{}` has no index signature; `Object.create(null)` is typed `any` and infects everything downstream | `const auto: Record<string, TestResult[]> = {}`. Prefer `Record` over `Map` — these are serialised to JSON in `coverage-report.js`, so switching to `Map` would be a behaviour change |
| DOM traversal via `node.childNodes` then `.tagName` / `.getAttribute` / `.innerHTML` / `.replaceWith` | `app/js/editor/serialize.js:139,145,150`; `app/js/sanitize.js`; `app/js/reader.js:250,318` | **MEASURED: 18 errors.** `childNodes` yields `ChildNode`; `querySelectorAll` yields `Element` (no `dataset`); `replaceWith` lives on `ChildNode` not `Node` | Narrow with `instanceof HTMLElement` — **strictly better runtime code** than the `n.tagName &&` duck-tests it replaces. Use the generic `querySelectorAll<HTMLElement>(...)` where the element kind is known |
| `window.__graph = {...}` — the only global assignment in the codebase, and self-referential (`hitTest` calls `window.__graph.nodeAt`) | `app/js/graph.js:207` | TS2339 on `Window`. A local cast at the assignment does not fix the read inside | `declare global { interface Window { __graph?: GraphTestApi } }` in `app/js/types/globals.d.ts`. Hoist to a local `const` first so the self-reference resolves. **Confirm it is still live** — `grep -rn "__graph" tests/` returns nothing today |
| Cross-module `CustomEvent` with no typed detail: `document.addEventListener('webdoc:run-test', e => e.detail.testId)` | `app/js/main.js:237-238`; dispatched from `app/js/coverage-report.js:127` and `app/js/requirements/render.js:155` | An unknown event name resolves the listener parameter to base `Event`, which has no `detail` | `declare global { interface DocumentEventMap { 'webdoc:run-test': CustomEvent<RunTestEventDetail> } }`. The `RunTestEventDetail` typedef already exists at `main.js:35` |
| Closure-style JSDoc function types: `@typedef {function(string, BlockRenderContext): (Node\|Promise<Node>\|void)} RenderBlockFn` | `app/js/blocks.js:46`, `app/js/map-view.js` — 13 occurrences | Accepted by TS 5.9.3, **rejected by TS 7.0.2 with TS1003 — and that one parse error suppresses all semantic diagnostics program-wide** | Rewrite to arrow form: `@typedef {(src: string, ctx: BlockRenderContext) => Node\|Promise<Node>\|void} RenderBlockFn`. Also fix `void` inside the union (it poisons the union at the call site) |
| Unions written in prose: `@property {string} status - 'pass'\|'fail'\|'partial'\|'untested'` | `app/js/coverage.js:73`; also `md/blocks.js:33,38`, `graph/chrome.js:45`, `graph/render.js:152`, `report.js:79`, `graph/layout.js:29,63`, `map-view.js:38,39`, `main.js:44`, `graph/util.js:17` — ~12 sites | The compiler sees `string` and enforces nothing. Never shows up in the error count, which makes it easy to miss in an audit that only reads tsc output | Promote to literal unions. `app/js/requirements/parse.js` already does this correctly, so it is a consistency fix, not a new convention |
| Escape-hatch union that defeats property access: `@property {Object<string, TestRunRecord\|Object<string,*>>} manual` | `app/js/coverage.js:64` | Every read must be valid on **both** arms, so nothing narrows. Looks permissive; is more restrictive than either arm alone | Name the second arm `LegacyTestRunRecord`, write one predicate `isLegacyRun(r): r is LegacyTestRunRecord { return !('run' in r) }`, call it once inside `manualTests()` |
| `@typedef {HTMLDetailsElement & {_load: () => Promise<void>}} FolderDetails` | `app/js/tree.js:30` | `document.createElement('details')` returns `HTMLDetailsElement`; assigning `_load` errors, and every read needs a cast. The intersection can be named but never legally produced | Drop the monkey-patch: hold the loaders in a module-local `WeakMap<HTMLDetailsElement, () => Promise<void>>`. Under Svelte this type disappears entirely |
| Bare `Object` / `Object[]` / `Object<string, *>` where the named type already exists in the repo | `app/js/auth-ui.js:255-256`, `app/js/editor.js:78,80,83`, `app/js/app-shell.js:20`, `app/js/auth.js:53`, `app/js/editor/serialize.js:24` | `Object<string, *>` becomes `Record<string, any>` and silently disables checking on the app's most important values. `auth-ui.js` carries 37 JSDoc tags and **zero type imports** despite being `auth.js`'s only consumer | Mechanical substitution of the existing named type. Two need new types first: `AccessBlock` (for `auth.js:53` and `serialize.js:24` — same shape) and an extended `SiteConfig` that actually declares `plugins` and the auth policy `app-shell.js:20` documents. **Cheapest high-yield pass in the whole migration** |
| Copy-pasted JSDoc block whose `@param` names do not match the function's parameters | `app/js/editor/serialize.js:73-77` | TS8024 twice (`'ranges'` and `'pos'` name no parameter) plus TS2322 for the false `@returns {boolean}`. **Nothing in the current toolchain checks JSDoc against signatures** | Correct to `@param {string} body` / `@returns {[number, number][]}`. This is the argument for the config itself in miniature |

### The three load-bearing modules — and an important scope correction

The brief calls `app/js/dom.js`, `app/js/html.js` and `app/js/app-shell.js` load-bearing because every other module depends on them. That is true of the *dependency graph* — `dom.js` has 17 importers, `icons.js` has 11 — but the measured error attribution points somewhere different, and the Svelte plan changes the calculus for two of the three.

**`app/js/dom.js` (75 lines) and `app/js/html.js` (37 lines) are excluded from the phase-0 include ratchet entirely.**

They account for **~92 of the 581 errors across 398 call sites**, and **every one of those call sites becomes Svelte markup.** The correct signature for `elem()` is a generic over `HTMLElementTagNameMap` with a mapped `ElemProps<K>` and template-literal `on${Capitalize<K>}` event keys — which is effectively unwritable in JSDoc. Writing it in JSDoc, then again in `.ts`, then deleting the module, is the clearest single instance of waste available. Roughly 60% of `dom.js`'s call sites are inside imperative view modules Svelte deletes anyway.

So: leave both as unchecked `.js` through rung 1 and rung 2, convert them at rung 3 only if they still exist, and delete them in the Svelte cleanup wave. The signatures below are the **rung-3 target**, recorded here so the design decision is not re-made later — they were prototyped and compiled clean under `--strict`.

#### `app/js/dom.js` — `elem()`, the rung-3 signature

```ts
export type Child = Node | string | number | boolean | null | undefined;
export type Children = Child | Children[];

type EventProps<E extends HTMLElement> = {
  [K in keyof HTMLElementEventMap as `on${Capitalize<K>}`]?:
    (this: E, ev: HTMLElementEventMap[K]) => void;
};
type WritableKeys<T> = { [K in keyof T]-?: T[K] extends Function ? never : K }[keyof T];

export type ElemProps<E extends HTMLElement = HTMLElement> =
    Partial<Pick<E, WritableKeys<E> & keyof E>>
  & EventProps<E>
  & { class?: string; text?: string; html?: string; style?: string; role?: string }
  & { [a: `data-${string}`]: string | number | boolean | null | undefined }
  & { [a: `aria-${string}`]: string | number | boolean | null | undefined };

export function elem<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: string | ElemProps<HTMLElementTagNameMap[K]>,
  ...children: Children[]
): HTMLElementTagNameMap[K];
export function elem(
  tag: string,
  props?: string | ElemProps<any>,
  ...children: Children[]
): HTMLElement { /* body unchanged */ }
```

Three notes from actually compiling this. The implementation signature **must** use `ElemProps<any>`, not `ElemProps<HTMLElement>` — the latter produces TS2394 "This overload signature is not compatible with its implementation signature". The `on${Capitalize<K>}` mapping is what makes `onClick: e => e.clientX` resolve `e` to `MouseEvent`. And `applyProps`'s `else if (key in node) node[key] = value` (`dom.js:72`) needs exactly one narrowly-scoped cast — `(node as unknown as Record<string, unknown>)[key] = value` — because `key in node` narrows `node`, never `key`; keep the runtime `in` guard, it *is* the type check.

Also at rung 3: `append()`'s `child.nodeType ? child : document.createTextNode(String(child))` (`dom.js:51`) becomes `child instanceof Node ? ...`, which narrows properly and is the same runtime cost. And once this lands, delete the hand-written `@returns {HTMLInputElement}` / `{HTMLTextAreaElement}` shim wrappers at `app/js/editor/widgets.js:120`, `:185`, `:196` — they exist only to paper over the flat return type.

Call-site distribution, for sizing: 398 `elem('tag'` sites — div 140, span 65, button 54, p 36, input 31, label 16, a 11, and a long tail. The 31 `input` + 3 `textarea` + 3 `select` + 1 `canvas` + 11 `a` sites are where the current signature costs the 92 errors.

#### `app/js/html.js` — the tagged template, rung-3 signature

`html.js` is the only meaningful file in `app/js/` with **zero** JSDoc. At `strict: false` it produces **0 errors precisely because it asserts nothing**; at `strict: true` it produces 7.

```ts
export function html(
  strings: TemplateStringsArray,
  ...values: Children[]
): DocumentFragment;

export function fillSlots(root: Node, values: Children[]): void;
```

Reuse `dom.js`'s `Children` type verbatim — the file header states the slot-filling semantics are identical to `append()`'s, so the shared type is what makes the two builders provably interchangeable.

Inside `fillSlots`, the TreeWalker needs `Comment`, not `Node`: `html.js:26`'s `.data` and `html.js:35`'s `.replaceWith` both fail on `Node`. The `NodeFilter.SHOW_COMMENT` filter guarantees the type, TS's lib does not model that, so a `Comment` assertion is honest here:

```ts
const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
const slots: Comment[] = [];
let node: Node | null;
while ((node = walker.nextNode())) {
  if ((node as Comment).data === 'slot') slots.push(node as Comment);
}
```

**Keep the runtime slot-count throw.** It catches the attribute-position `${}` mistake the file header warns about, which no type can catch — `strings.length - 1` is not tracked in `TemplateStringsArray`. This is a case where the answer is types **and** the existing assertion, not types instead of it.

#### `app/js/app-shell.js` — this one converts first, and it survives

Unlike the other two, `app-shell.js` is genuinely load-bearing and worth real investment at rung 1. It has **0 loose / 2 strict errors** itself, but it is the *source* of 78 errors elsewhere.

**The `el()` split.** `export const el = id => document.getElementById(id)` (`app-shell.js:32`) is correctly typed `HTMLElement|null` — which is exactly why it produces the second-largest cluster. Split it in two rather than casting at ~200 call sites:

```ts
export const el = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

export function mustEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error('missing #' + id);
  return n as T;
}

export const input = (id: string): HTMLInputElement | null =>
  document.getElementById(id) as HTMLInputElement | null;
```

Keep `el` for genuinely-optional lookups (`auth-ui.js` runs before parts of the shell exist). Use `input(id)` for the 55 `.value` reads. Use `mustEl` for the ~56 static-shell ids in `app/index.html`.

**This is a real behaviour improvement, not type ceremony.** A renamed id in `index.html` today silently no-ops; with `mustEl` it fails loudly at boot with the missing id in the message. Do **not** solve this with `!` at each call site — that is ~200 unchecked assertions with no runtime benefit.

**MEASURED: roughly 100 of the 171 strictNullChecks errors die at once from this split.** The `@template {HTMLElement} T` form works in JSDoc, so the generic lands at rung 1; only the mapped-type work is deferred.

**The `AppRegistry` fix.** `export const app = {}` typed `@type {AppRegistry}` (`app-shell.js:118-130`) declares nine optional members. The all-optional-plus-truthiness-guard pattern is **fine in TypeScript** — `if (app.x) app.x(...)` narrows correctly, and it is the idiomatic way to write a late-bound registry. The registry is not the bug.

The bug is the missing declaration: `app.updateDocActions` is assigned at `app/js/authoring.js:77` and called at `app/js/reader.js:86` but is absent from the typedef. **MEASURED: 3 × TS2339** (`authoring.js:77`, `reader.js:86:11`, `reader.js:86:33`).

Add it — `@property {(docId: string) => Promise<void>} [updateDocActions]` — and stop there. **Do NOT reach for an index signature or `Partial<Record<string, Function>>` to make the errors go away** — that would delete the exact property this exercise just proved is valuable. And do not redesign the registry: under Svelte it becomes `setContext` or a runes store, and the file's own comment (`:115-118`) says it exists to break import cycles that Vite tolerates anyway.

**One more here:** `AppState.site` (`app-shell.js:20`) is typed `Object<string, *>|null` while `SiteConfig` (`catalog.js:21`) exists and is referenced exactly once in the whole codebase. Wire it up. Also delete the vestigial `spy` field (`app-shell.js:23`, `:26`) — its own doc comment says it is "not assigned anywhere in the current code"; `reader.js` keeps its own module-local `IntersectionObserver`.

---

## TypeScript: conversion phases

Each step states goal, files, exit criterion, verification, revert, and its relationship to the Svelte phases.

### Step 0 — Fix the unparseable module

- **Svelte interlock:** BEFORE literally everything. Do this today regardless of whether any of the rest is approved.
- **Goal:** the editor loads in a browser again.
- **Files:** `app/js/editor/serialize.js:79` (raw U+000A inside a regex character class — a two-character fix, `\n` instead of the literal newline) and `app/js/editor/serialize.js:73-77` (the JSDoc block copy-pasted from `inFence(ranges, pos)` onto `codeSpanRanges(body)`).
- **Exit criterion:** every module in `app/js/` parses.
- **Verification:** `node --input-type=module --eval "import('file:///C:/Users/panda/Web_Doc/app/js/editor/serialize.js')"` exits 0. Note `node --check` returns 0 on the broken file and will **not** verify this.
- **Revert:** `git checkout -- app/js/editor/serialize.js`.
- **Note:** both defects are uncommitted changes from the in-flight access-control work — `git show HEAD:app/js/editor/serialize.js` has no `codeSpanRanges` at all.

### Step 1 — `tsconfig.json` + `package.json`, include narrowed to the green set

- **Svelte interlock:** BEFORE any Vite scaffolding.
- **Goal:** CI green and **gating** from commit two.
- **Files:** new `tsconfig.json`, new `package.json`, `.gitignore` (add `node_modules/`, `*.tsbuildinfo`), and rewrite the "no Node.js, no npm, no package.json anywhere" claim in `tests/README.md` and `tests/requirements-dev.txt`.
- **Exit criterion:** `npx tsc --noEmit` exits 0 with `include` covering the 8 strict-clean files, and a CI job fails the build on any error.
- **Verification:** `npx tsc --noEmit`, plus a **false-green smoke test** — append `export const x = totallyUndefined;` to an included file and confirm tsc reports TS2304. This is how you prove the TS version pin held.
- **Revert:** delete two files.

### Step 2 — `app/js/graph.js`: the `GraphContext` typedef

- **Svelte interlock:** BEFORE the first Svelte component. Highest-leverage single change available.
- **Goal:** retire 55% of the loose backlog.
- **Files:** `app/js/graph.js` (annotate the construction site at `:124`, complete/decompose the typedef at `:78`, rename the `map-view.js:20` sibling to `GraphHandle`, delete the disagreeing inline `@returns` at `:107-120`).
- **Exit criterion:** `graph.js` and the five `graph/*` modules in `include`, zero errors. **ESTIMATED landing zone 260–300 total loose errors**, not the 242 the permissive measurement suggested.
- **Verification:** `npx tsc --noEmit`; `python -m pytest tests/test_e2e.py` still green (the graph is DOM-contract tested).
- **Revert:** revert the commit; nothing else depends on it.
- **Review criterion, make it explicit:** **reject any diff to `graph.js` containing `[key: string]: any`.** An index signature makes 321 errors vanish in five minutes and destroys the value of the exercise for 62% of the codebase's error mass. The temptation peaks exactly when the estimate is under pressure.

### Step 3 — `app/js/app-shell.js` only

- **Svelte interlock:** BEFORE. `app-shell.js` survives the port (as `app-shell.svelte.ts`); `dom.js` and `html.js` do not.
- **Goal:** the `el` / `input` / `mustEl` split, and the missing `updateDocActions` registry member.
- **Files:** `app/js/app-shell.js`, plus mechanical call-site updates in `app/js/main.js`, `app/js/auth-ui.js`, `app/js/editor/panels.js`, `app/js/coverage-view.js`.
- **Exit criterion:** `app-shell.js` in `include`, zero errors, and the three `updateDocActions` TS2339s gone.
- **Verification:** `npx tsc --noEmit`; `python -m pytest tests/test_e2e.py` (the `mustEl` throw changes boot behaviour on a missing id — that is the point, but it must be exercised).
- **Revert:** revert the commit.
- **Explicit scope limit:** `app/js/dom.js` and `app/js/html.js` are **NOT** in this step and are **NOT** added to `include` at any point before rung 3. See the scope correction above.

### Step 4 — Event handler parameters

- **Svelte interlock:** BEFORE.
- **Goal:** clear the 23 `on type 'Event'` errors.
- **Files:** `app/js/graph/interactions.js`, `app/js/graph/chrome.js`, `app/js/panzoom.js`.
- **Exit criterion:** those three in `include`, zero errors.
- **Verification:** `npx tsc --noEmit`.
- **Revert:** revert the commit.
- **Note:** the fix is usually to **delete** the `@param {Event}` tag, not replace it. Where the handler is stored for teardown, annotate at the declaration.

### Step 5 — `app/js/types.js`

- **Svelte interlock:** BEFORE. Settling the domain vocabulary now means Svelte component props reference `Doc`, `RequirementEntry`, `GraphHandle` from day one instead of inventing a second set.
- **Goal:** hoist the ~60 shared types; kill the duplicates named in the type-model section.
- **Files:** new `app/js/types.js` (`@typedef` blocks plus `export {}`), plus the alias edits in the ~29 files carrying `{import('./x.js').Y}`.
- **Exit criterion:** duplicates 1, 2, 2b, 3, 4, 9, 10, 11 resolved; all three type-only import cycles dissolved; `include` widened.
- **Verification:** `npx tsc --noEmit`; and confirm the cycles are gone by inspection of the import graph.
- **Revert:** revert the commit — types-only, no runtime change.
- **Also here:** declare `GraphInputNode` and fix `createGraph`'s `@param {Doc[]} docs` (`graph.js:106`), which **neither caller satisfies** — `map-view.js:173` passes `GraphDocNode[]`, `coverage-view.js:127` passes synthesised `{id, title, description, assumes, next}` pseudo-nodes. Neither has `Doc`'s required `source`/`rel`/`url`/`name`. **Do not cast the call sites.**

### Step 6 — The wire boundary

- **Svelte interlock:** BEFORE.
- **Goal:** one `getJson<T>` helper, per-endpoint response types, discriminated `AuthResult<T>`, and the `RestrictedError` class.
- **Files:** `app/js/auth.js`, `app/js/catalog.js`, `app/js/main.js`, `app/js/authoring.js`, `app/js/auth-ui.js`, `app/js/map-view.js`, `app/js/search.js`, `app/js/tree.js`, `app/js/reader.js`, `app/js/requirements.js` (the 15 fetch sites).
- **Exit criterion:** all 16 `.json()` sites typed; the four wrong property reads fixed; `include` widened.
- **Verification:** `npx tsc --noEmit`; `python -m pytest tests/test_access_control.py` (the auth flows are covered end-to-end there).
- **Revert:** revert the commit.
- **Do NOT add zod/valibot.** The server is same-origin, first-party, Python stdlib-only, and the client is already defensive at every site (`catalog.js:84` `if (!res.ok) return;`, `catalog.js:89` `listing.entries || []`, `map-view.js:95` returns a prebuilt empty model on any failure). A runtime schema library would spend the project's dependency-budget concession a second time for far less than Svelte bought. **The one exception** worth a hand-written guard is `/site.json`'s `theme` and `plugins` — user-authored config where a typo is a realistic failure mode that the current code cannot distinguish from a network error.
- **Read the `serve.py` handlers while writing this.** The types for `/api/index/coverage`, `/api/index/resolve`, `/api/auth/users` and `/api/xml/<source>` are otherwise inferred from client consumption only — which is structurally the same setup that let the JSDoc drift.

### Step 7 — Editor and serializer unions

- **Svelte interlock:** BEFORE.
- **Goal:** clear the `access-start`/`access-end` drift.
- **Files:** `app/js/editor/serialize.js:124`, `app/js/editor.js:73`, `app/js/editor.js:77` (`EditorOpts.knownGroups`, passed by `authoring.js:187`), `app/js/map-view.js:38-49` (`DocMapState.hiddenGroups`).
- **Exit criterion:** those in `include`, zero errors.
- **Verification:** `npx tsc --noEmit`.
- **Revert:** revert the commit.
- **Worth naming to whoever approves this plan:** every one of these was introduced by the same in-flight access-control feature as the step-0 syntax error. **The JSDoc is accurate where it is old and drifting where it is new, because nothing has ever checked it.**

### Step 8 — The 13 Closure-style typedefs

- **Svelte interlock:** BEFORE. This is the prerequisite for ever moving off the 5.9 pin.
- **Goal:** `@typedef {function(A,B): C}` → `@typedef {(a: A, b: B) => C}`.
- **Files:** `app/js/blocks.js` (including `:46`), `app/js/map-view.js`.
- **Exit criterion:** `npx tsc --noEmit` reports the same error count under `typescript@7.0.2` as under `~5.9.3` (**MEASURED to be 570 vs 581 pre-fix, i.e. consistent**). Also fix `void` inside the `RenderBlockFn` union and give `new Map()` at `blocks.js:66` its type arguments.
- **Verification:** run tsc under both pinned versions and diff the counts.
- **Revert:** revert the commit.

**End of rung 1.** `include` = `["app/js/**/*.js"]` minus `dom.js`/`html.js`, `tsc --noEmit` at `strict: false` is zero, CI gates. **~5 days.**

### Step 9 — `noImplicitAny` alone

- **Svelte interlock:** BEFORE, but **this is the one step that can safely OVERLAP the Vite scaffolding.** It touches only lambda parameters and accumulator declarations in files (`app/js/graph/layout.js`, `app/js/coverage.js`, `app/js/md/*`) the component migration does not open. Run in parallel if schedule pressure demands; it is the only low-risk parallelism here.
- **Goal:** clear the 349 implicit-any errors.
- **Files:** tree-wide, concentrated in `app/js/graph/layout.js` (1 → 45 errors when the flag flips), `app/js/coverage.js`, `app/js/coverage-view.js`.
- **Exit criterion:** zero errors with `noImplicitAny: true`.
- **Verification:** `npx tsc --noEmit`.
- **Revert:** flip the flag back off.
- **Incidental cleanup while here:** `app/js/graph/layout.js` contains **2 literal NUL bytes** used as a hash-key delimiter (`_fnv(e.from + '\0' + e.to + '\0' + e.type)`), which makes grep treat the file as binary and some diff viewers skip it. Replace with U+001F. `app/js/coverage.js` has 4 more.

**End of rung 2. THIS IS THE PRE-SVELTE TARGET. ~7 days cumulative, zero runtime bytes changed, zero build step introduced.**

---

*Everything below happens after Vite exists.*

### Step 10 — Vite lands (same commit as the Svelte toolchain phase)

- **Svelte interlock:** SAME COMMIT as the Svelte phase-0 toolchain.
- **Goal:** the build exists without breaking anything that currently passes.
- **Files:** new `package.json` deps, `vite.config.ts`, `svelte.config.js` (svelte-check requires one even with no preprocessors), new `tsconfig.json` per the Vite-phase config above, plus the phase-0 config renamed to `tsconfig.legacy.json`.
- **Four things that must land in this commit:**
  1. **`src/` is a NEW tree OUTSIDE the served root; the build output goes INTO `app/`.** `APP_DIR` is hardcoded at `serve.py:39` with no config override, and is reused for the auth-directory containment check at `serve.py:113`. Building into `app/` leaves `serve.py`, `tests/conftest.py` and every Playwright selector untouched, and the CSP inline-script hashes **self-heal** because `serve.py:1517` re-reads and re-hashes `app/index.html` from disk at startup. Raw `.ts` then never reaches the served root at all — which is a stronger guarantee than adding a `CONTENT_TYPES` entry, and it matters because Windows `mimetypes` resolves `.ts` to `video/vnd.dlna.mpeg-tts`.
  2. **Pin the entry filename:** `build.rollupOptions.output.entryFileNames: 'js/main.js'`, so `app/index.html:81` and the existing assertion at `tests/test_access_control.py:747` (`assert c.get("/js/main.js").status == 200`) both keep passing with **zero test churn.** Do not edit a passing test as part of a toolchain migration if you can make the toolchain honour the existing contract.
  3. **`/* @vite-ignore */` on `app/js/plugins.js:29`.** The specifier `await import(\`../thirdpartyrenderer/${name}.js\`)` is computed from `config.json`'s plugins list. Rollup will glob `../thirdpartyrenderer/*.js` and bake the **build machine's** plugin set into the artifact, destroying the drop-in contract that the `.gitignore` rule for `app/thirdpartyrenderer/*.min.js` exists to protect. Compounded by `app/thirdpartyrenderer/mermaid.js`, which imports back into `../js/blocks.js` and `../js/panzoom.js` and does `new URL('./mermaid.min.js', import.meta.url)` against a 3.5 MB gitignored file absent from a clean clone. Pass the whole folder through unbundled.
  4. Add `".map": "application/json; charset=utf-8"` to `serve.py`'s `CONTENT_TYPES` dict (`serve.py:55-71`) — Windows `mimetypes.guess_type('x.map')` returns `text/plain`.
- **Exit criterion:** `npx vite build` emits `app/js/main.js`; `npx tsc --noEmit` (both configs) exits 0; `python -m pytest tests/` fully green including `test_access_control.py` and `test_conformance.py`.
- **Verification:** the above, **plus a CI smoke test that builds with `app/thirdpartyrenderer/` EMPTY and asserts the app boots** — that is the clean-clone case and nobody will hit it locally.
- **Revert:** the `app/js/` tree is still intact and `index.html` still points at `/js/main.js`; revert the config commit.

### Step 11 — The pure-logic frontier converts to `.ts`

- **Svelte interlock:** BEFORE any component moves. This is the **end-to-end toolchain proof**.
- **Goal:** prove build → `app/` → `serve.py` → Playwright green on the cheapest, lowest-blast-radius files.
- **Files, in order:** `src/lib/types/*.ts` (from `app/js/types.js`) → `src/lib/markdown/` (the 9 `md/*` files + `app/js/commonmark.js` + `app/js/sanitize.js`) → `src/lib/highlight/` (`highlight/grammars.js`, `highlight/lexer.js`, `highlighter.js`) → `numbering.js`, `doclinks.js`, `blocks.js`.
- **Why these first:** eight already pass **full strict** untouched, they have zero DOM (verified: grepping `document.` / `window.` / `DOMParser` across `commonmark.js` and all nine `md/*.js` returns zero hits), and they carry the highest existing test coverage.
- **Exit criterion:** no `.js` in those directories; `tsc --noEmit` at `strict: true` zero; `test_conformance.py` green.
- **Verification:** `npx tsc --noEmit && npx svelte-check`; `python -m pytest tests/`.
- **Revert:** `git mv` back; the JSDoc is recoverable from the previous commit.
- **This is where `MdBlockNode` becomes a real discriminated union** with a `never`-exhaustive default arm — a construct that exists properly only in `.ts`. **This is also where `app/dev/conformance-full.html` must be dealt with** (see tooling below), because it breaks the moment `commonmark.js` is renamed.

### Step 12 — The data/API layer converts

- **Svelte interlock:** BEFORE any component moves. Components in later waves consume these as prop and store types, so they must exist first.
- **Files, in dependency order:** `catalog.js` → `auth.js` → `search.js` → `requirements/parse.js`, `requirements/store.js`, `requirements.js` → `coverage.js` → `runner.js` (logic half) → `report.js`.
- **Exit criterion:** `src/lib/types/wire/*.ts` exists; `getJson<T>` is the only fetch path; `RestrictedError` has replaced the `catalog.js:147` monkey-patch.
- **Verification:** `npx tsc --noEmit && npx svelte-check`; `python -m pytest tests/test_access_control.py`.
- **Revert:** per module.
- **Dependency order is forced:** `catalog.js` has 9 type-importers, `requirements.js` 11, `coverage.js` 8.

### Step 13 — Rename rides inside each Svelte PR, per surface

- **Svelte interlock:** SAME COMMIT, always. **Never a standalone "convert everything to `.ts`" PR.**
- **Goal:** a module's rename, its retyping, and its componentisation are one atomic change reviewed once.
- **Exit criterion:** per surface — no `.js` remaining in a converted surface. Enforced by Svelte PR review, not a global flag.
- **Verification:** `npx tsc --noEmit && npx svelte-check --threshold error --fail-on-warnings`; `python -m pytest tests/test_e2e.py`.
- **Revert:** per PR.
- **Two things that land here and nowhere else:** the `elem()` mapped-type generic (if `dom.js` still exists), and the `RichBlock<HtmlString>` / `RichBlock<MarkdownString>` collapse of the eight duplicated editor block typedefs. Brands are unwritable in JSDoc — this is `.ts`-phase work by necessity.
- **Scope caution:** the graph wave (`graph/util.js`, `graph/layout.js`, `graph/render.js`, `graph.js`, `panzoom.js`, `map-view.js`) is ~2,200 lines and contains both the hardest type problem in the codebase and a canvas-to-component boundary. **Open a PR per module inside the wave** — a wave is a scheduling unit, not a PR unit. The rule is that a single *module's* rename, typing and componentisation stay together, not that a whole subsystem does.

### Step 14 — HARD STOP-OR-ACCEPT CHECKPOINT (after the graph subsystem)

- **Svelte interlock:** immediately after the graph wave.
- **Goal:** make the abandonment decision **deliberately**, rather than drifting into it.
- **Decision:** if the graph wave has not landed by this point, **stop.** Accept the mixed state as an endpoint: `checkJs` stays on over the remaining `.js` via `tsconfig.legacy.json`, the converted `src/` stays strict `.ts`, and the project ships. Do not start the editor or shell waves.
- **Why this exists:** the worst realistic outcome of this plan is not being wrong — it is being half-done and drifting. A deliberate mixed endpoint with `checkJs` gating the un-migrated half is a defensible artifact. An accidental one is two dialects, two mental models, and a mandatory build step in a project whose prior identity was not having one.
- **Verification:** both tsconfigs exit 0; full `pytest` green.

### Step 15 — `strictNullChecks`, per surface, deliberately last

- **Svelte interlock:** AFTER the component migration.
- **Goal:** `strict: true` at the top level with no per-file exemptions.
- **Why deferred:** the ~186 strictNullChecks errors are the **only genuinely expensive population** — each needs a real decision (guard, assert, or restructure), not a mechanical edit — and they are concentrated in exactly the modules Svelte replaces: `app/js/graph/chrome.js` (106 strict errors), `app/js/auth-ui.js` (34), `app/js/coverage-view.js` (26), `app/js/editor/panels.js` (20). These are imperative DOM-building view modules whose entire reason for existing is what a component template does. Spending 4–5 days on null-safety decisions inside files scheduled for deletion is the one clearly wasteful ordering on the table.
- **The explicit exception, do NOT defer these:** `app/js/graph/render.js` (144 strict errors) and `app/js/graph/layout.js` (45) are drawing and geometry math that **survives the port intact.** `layout.js`'s 45 are pure mechanical parameter annotation and land in step 9. Treating the whole graph subsystem as "deferred" would wrongly skip work worth doing early.
- **Exit criterion:** `strict: true`, `allowJs: false`, zero errors, no `.js` under `src/`.
- **Verification:** `npx tsc --noEmit && npx svelte-check`; full `pytest`.
- **Revert:** flip `strict` back.

**A caveat this plan owes the reader.** Step 15's deferral rests on an assumption about the Svelte component-migration plan: that Svelte **deletes** `graph/chrome.js` and `auth-ui.js` rather than wrapping them. **Confirm this against the Svelte plan before committing to the ordering.** If those modules survive as-is inside component shells, the case for deferring `strictNullChecks` weakens considerably and full strict before migration becomes the better call. This is the single largest swing factor in the design.

---

## TypeScript: tooling and CI

### Commands

| Phase | Command | Runs where |
| --- | --- | --- |
| Rungs 0–2 | `npx tsc --noEmit` | CI + locally on demand |
| After Vite | `npx tsc --noEmit && npx svelte-check --tsconfig ./tsconfig.json --threshold error --fail-on-warnings` | CI |
| After Vite | `npx tsc --noEmit --project tsconfig.legacy.json` | CI, while un-migrated `.js` remains |

`package.json` scripts: `"check": "tsc --noEmit"` at phase 0, extended to the compound form when Vite lands.

**Speed makes this a non-issue.** MEASURED: cold full check 1.24–1.31 s; `strict: true` 1.42 s; incremental no-op 0.76 s. Combined with `svelte-check`, ESTIMATED well under 3 s for this tree. There is no case for `--watch` and no case for treating type-checking as a slow gate.

### There is no CI today — build it

There is no `.github/` directory at all. `ls .git/hooks | grep -v sample` is empty and `git config core.hooksPath` is unset. There is no `.editorconfig`, no prettier config, no eslint config, no `package.json`.

One workflow, three jobs: **tsc**, the **conformance runner**, and **pytest + playwright**. Add `node_modules/` and `*.tsbuildinfo` to `.gitignore` (which currently ignores only `app/thirdpartyrenderer/*.min.js`, `.webdoc-index/`, `__pycache__/`, `.claude/` and `.webdoc-auth/`).

### Linter: do NOT add ESLint for the JS/TS body

**One-line justification: on this codebase tsc with four free flags finds a strict superset of what `eslint:recommended` finds, without the ~25 false positives.**

The evidence, all MEASURED. `eslint:recommended` produced **116** findings on this tree. Classified: **64** of the 79 `no-unused-vars` are the ignored binding in `catch (e)` — the project's pervasive deliberate idiom, which TypeScript exempts by design. All **19** `no-empty` are the matching empty catch bodies. The **2** `no-irregular-whitespace` are deliberate literal U+FEFF characters inside BOM-stripping regexes at `app/js/authoring.js:416` and `app/js/catalog.js:114`. The **2** `no-control-regex` are deliberate NUL sentinels at `app/js/md/inline.js:52` and `app/js/sanitize.js:50`. The **1** `no-regex-spaces` flags `/  $/` at `app/js/md/inline.js:170`, which is the CommonMark two-space hard-break rule and is correct as written.

And the decisive half: the **15** genuinely-useful ESLint findings (real dead code — `RE_WWW`/`RE_URLAUTO` in `md/inline.js:54-55`, `NODE_W` in `graph/render.js:230`, `recolor` in `coverage-view.js:189`) are **all** also found by tsc. With `noUnusedLocals` + `noUnusedParameters` + `noImplicitReturns` + `noFallthroughCasesInSwitch`, tsc reports **19** TS6133 findings — a strict superset, adding `newMeta` (`authoring.js:191`), `m` (`editor/serialize.js:301`), `keepView` (`map-view.js:146`), `leaf` (`md/blocks.js:407`) and `docs` (`requirements.js:97`).

Zero true positives missed, ~25 false positives avoided, one less tool. Adding ESLint here means writing ~25 rule exemptions whose only content is "this codebase is allowed to be itself" — and re-litigating each one whenever a preset updates.

**The one exception, once Svelte lands: adopt `svelte-check`.** It is not optional. tsc physically cannot parse a `.svelte` file — it is not JS, and TS has no plugin hook for alternative file grammars. `svelte-check` runs the language server headlessly: `svelte2tsx` transforms each component into a synthetic TSX module and maps diagnostics back to the original line/column. It also covers template and a11y checking that tsc structurally cannot do, which subsumes the useful half of `eslint-plugin-svelte`.

### Source maps

`serve.py:1038` serves any file under `APP_DIR` by extension-agnostic `safe_join` + `os.path.isfile`, so a `.map` next to the bundle **is** served with no code change. But `content_type()` (`serve.py:74-76`) falls through to `mimetypes`, and MEASURED on Windows: `mimetypes.guess_type('x.map')` returns `('text/plain', None)`. Add one line to the `CONTENT_TYPES` dict at `serve.py:55-71`.

**The privacy consideration nobody will think of:** the app shell is **ungated by design** — `serve.py`'s comment on the `/js/main.js` route states "The app shell itself is always served: the sign-in screen is part of it." So a sourcemap with `sourcesContent` inlined publishes the entire TypeScript source to anonymous visitors.

- Internal deployments: `sourcemap: true` with `sourcesContent` inlined (Vite's default), so no `.ts` file is ever fetched over HTTP.
- Internet-facing instances with auth on: `build.sourcemap: 'hidden'` — maps emitted for offline error decoding, no `//# sourceMappingURL` comment.

Either way, **keep `.ts` sources outside `APP_DIR` entirely.** Windows `mimetypes.guess_type('x.ts')` returns `('video/vnd.dlna.mpeg-tts', None)` — `serve.py` would happily hand out raw TypeScript as MPEG-TS video.

**One lucky property worth knowing:** the CSP survives the build automatically. `serve.py:1517` builds `script-src` as `["'self'"] + _inline_script_hashes(os.path.join(APP_DIR, 'index.html'))`, and `_inline_script_hashes` (`serve.py:178-194`) re-reads `index.html` from **disk at startup** and SHA-256s every inline `<script>` without a `src`. So when Vite rewrites `app/index.html`, the pre-paint theme script's hash is recomputed on next server start — no manual CSP maintenance, and `test_the_csp_has_no_unsafe_inline_scripts` keeps passing. This is the strongest single reason to build into `app/` rather than `dist/`.

### The `app/dev/*.html` harness problem

All four harnesses import `app/js` modules directly as browser ES modules, by absolute URL:

| File | Line | Import |
| --- | --- | --- |
| `app/dev/conformance.html` | 90 | `import { renderMarkdown, INTERIM } from '/js/commonmark.js';` |
| `app/dev/conformance-full.html` | 103 | `import { renderMarkdown } from '/js/commonmark.js';` |
| `app/dev/highlight-demo.html` | 156 | `import { highlightWithin } from '/js/highlighter.js';` |
| `app/dev/graph-demo.html` | 54 | `import { createGraph } from '/js/graph.js';` |

The browser cannot load `.ts` and `serve.py` has no transform, so all four break the moment those modules are renamed — **and that happens in step 11, the earliest wave, when the team is least expecting fallout.**

**Severity is not uniform.** Only `conformance-full.html` is load-bearing: `tests/test_conformance.py:25` does `page.goto('/dev/conformance-full.html')` and asserts on `body[data-done='1']` plus `data-pass`/`data-total`/`data-sections`/`data-error` (set at `conformance-full.html:160-161` and `:265-268`), and it is **GATING** (`BASELINE_PASS_RATE = 0.55`, plus `assert total > 600`). The other three are referenced by no test — manual eyeball harnesses only.

**Resolution — split by value:**

1. **Move the conformance measurement out of the browser, in step 11 itself, not later.** The markdown engine is **provably DOM-free**: grepping `document.` / `window.` / `DOMParser` / `HTMLElement` / `getElementById` / `createElement` across `app/js/commonmark.js` and all nine `app/js/md/*.js` returns **zero hits** (only `app/js/sanitize.js` has 5, and the conformance path never touches it). The harness's own `normalizeHtml` (`conformance-full.html:122-142`) is likewise pure string manipulation. MEASURED: importing the real module into plain Node ran the full 652-example official spec in **14 ms**, with module import at 10 ms, zero shims. Against that, the current Playwright test launches Chromium, loads a page, and carries a **120-second** `wait_for_selector` timeout.
2. **Keep `graph-demo.html` and `highlight-demo.html`** as extra Vite multi-page entries via `build.rollupOptions.input`, so the build emits them with rewritten `<script src>` into `app/` and they keep working under `serve.py` unchanged. (Or retire them — confirm with the author first; this is a one-question conversation, not a research task.)
3. `tools/conformance/` is **empty** — `git ls-files tools/` returns zero rows, the whole tree is untracked with no files. It is a leftover directory, and it is the natural home for the new Node conformance runner.

**Re-measure the pass rate with the harness's real `normalizeHtml` while doing this.** My 96.78% Node figure used a looser whitespace-normalising compare and is **NOT** comparable to the 0.55 baseline — the finding is runnability and speed, not the rate. A 0.55 floor looks stale enough to be worthless as a regression gate, but that must be confirmed, not assumed.

### The mechanical `.svelte.ts` guard

Runes are compile-time macros. `vite-plugin-svelte` only transforms `.svelte`, `.svelte.js` and `.svelte.ts`. **`$state` in a plain `.ts` is silently non-reactive** — no compile error, no runtime error, the app just degrades in ways that look like unrelated UI bugs. This bites in the shell wave, the busiest one, when `app-shell.js` becomes the runes store.

A failure mode this silent needs a check, not a note in a plan document. **Add a one-line CI grep asserting that no plain `.ts` under `src/` contains `$state(`, `$derived(` or `$effect(`.**

### Pre-commit hook: not warranted

**No blocking pre-commit hook.** Two concrete reasons beyond the usual ones:

1. With a 581-error baseline, a blocking hook is unusable until rung 1 finishes — and the include-list ratchet already gives CI gating from commit two, which is the property a hook would be trying to buy.
2. This project's demonstrated failure mode is not "a developer skipped a check." It is that **no check existed on any machine** — which a hook (bypassable, local, per-clone) does not fix and CI does.

Revisit *after* the baseline is green. If a hook is added then, make it **pre-push, not pre-commit**: at 1.3 s cold the cost is trivial either way, but pre-commit punishes the work-in-progress commit, which is exactly the commit you most want people making freely.

### Documentation that becomes false

`tests/README.md` and `tests/requirements-dev.txt` both state the current constraint explicitly — that there is no Node.js, no npm, and no `package.json` anywhere. That sentence becomes false at **commit two**, not at the Vite commit. Both files need rewriting as part of step 1. Defensible — it is a devDependency behind `noEmit` that ships nothing — but it is the project's stated identity being broken slightly earlier than strictly necessary, and it should be a deliberate line in the commit message rather than a surprise.

---

## TypeScript: effort

| Step | Work | Days |
| --- | --- | --- |
| 0 | `serialize.js:79` regex + misattached JSDoc | 0.05 |
| 1 | `tsconfig.json` + `package.json` + CI gate on the green subset | 0.25 |
| 2 | `GraphContext` typedef + construction site + `GraphHandle` rename | 1.5 |
| 3 | `app-shell.js` — `el`/`input`/`mustEl` split + `updateDocActions` | 1.0 |
| 4 | Event handler parameters (`interactions.js`, `chrome.js`, `panzoom.js`) | 0.5 |
| 5 | `app/js/types.js` — hoist ~60 shared types, kill duplicates, dissolve cycles | 1.5 |
| 6 | Wire boundary — `getJson<T>`, `AuthResult<T>`, `RestrictedError` | 1.0 |
| 7 | Editor/serializer union drift | 0.5 |
| 8 | 13 Closure-style typedefs → arrow form | 0.5 |
| **— rung 1 subtotal —** | **`tsc --noEmit` at `strict: false` = 0, CI gating, all files in `include`** | **~5** |
| 9 | `noImplicitAny` — 349 mechanical errors | 1.5 |
| **— rung 2 subtotal: PRE-SVELTE TARGET —** | **Zero runtime bytes changed, zero build step introduced** | **~7** |
| 10 | Vite lands — `src/` layout, `entryFileNames` pin, `@vite-ignore`, `.map` MIME | 0.5 (TS share only) |
| 11 | Pure-logic frontier → `.ts` + Node conformance runner | 1.5 |
| 12 | Data/API layer → `.ts` + `types/wire/` | 1.5 |
| 13 | Rename per Svelte PR — `elem()` generic, `RichBlock<T>` brands | 1.0 (codemod, spread across Svelte PRs) |
| 15 | `strictNullChecks` at post-Svelte scope | 2.5 |
| **TOTAL** | | **~14** |

Two things this table does not include: the Svelte component migration itself, and the Vite spike (budget a half day separately — see risks).

**The largest uncertainty inside the number** is step 2. The 1.5-day figure assumes flat enumeration of the 81 undeclared `GraphContext` properties. If it is genuinely decomposed into four composed interfaces — which the Svelte port arguably makes the right call — **that item runs to 3 days, and the graph subsystem overall could reach 6–8.** Whether the decomposition is worth doing depends on the Svelte plan.

Steps 10, 11 and 12 are ESTIMATED; every rung-1 and rung-2 figure derives from measured error counts and their character (mechanical vs judgement-heavy).

---

## TypeScript: risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| **A strictness rung stalls the migration and the repo ends up half-done.** `GraphContext` fixed, `dom.js` not, `include` at 30 of 53 files, and the Svelte work starting anyway | Medium | High | **This is what the include-list ratchet exists for.** Every intermediate state is shippable AND gating, so an abandoned run still leaves CI enforcing whatever was completed. The artifact is a partially type-checked JS codebase with no build step — strictly better than the status quo. Pair with the step-14 stop-or-accept checkpoint on the Svelte side |
| **`.ts` breaks the standalone dev harnesses, and one of them is gating.** All four `app/dev/*.html` pages import `app/js` modules by absolute browser URL; `conformance-full.html:103` is driven by `tests/test_conformance.py` with a gating `BASELINE_PASS_RATE` | **High — this is near-certain, not speculative** | Medium | Move the conformance measurement to Node **in step 11 itself, not later** — the parser is provably DOM-free and the full 652-example spec runs in 14 ms there. Keep `graph-demo.html`/`highlight-demo.html` as Vite multi-page entries, or retire them after one question to the author. Note this breaks in the **earliest** wave, when the team is least expecting fallout |
| **Adopting `typescript@latest` and getting a FALSE GREEN.** TS 7.0.2 rejects the 13 Closure-style typedefs with TS1003, and MEASURED by control experiment, that one parse error suppresses ALL semantic diagnostics program-wide — 1 error for 53 files, and an appended undefined reference produced nothing | Medium | **Critical** — a team would conclude the codebase is nearly clean and move on | Pin `~5.9.3`, never `^`, never `latest`. **Verify the pin holds with a deliberate smoke test in the first CI commit**: introduce a reference to an undefined identifier and assert tsc reports it. Step 8 (arrow-form rewrite) is what makes 7.x safe later |
| **Shipping a non-zero baseline and calling it done.** `include: ["app/js/**/*.js"]` with 581 errors means CI cannot gate, the number becomes wallpaper, and within a month it is 640 and nobody noticed | Medium | High | Entirely a sequencing choice. The ratchet: start at 8 clean files, gate from commit two, widen per PR. **Never allow a state where the check runs but does not fail the build** |
| **Plastering `GraphContext` with an index signature.** `[key: string]: any` makes 321 errors vanish in five minutes and destroys the value for 62% of the codebase's error mass | Medium — the temptation peaks exactly when the estimate is under pressure | High | Make it an **explicit review criterion**, not a hope: review the `graph.js` diff specifically for index signatures and reject on sight |
| **The step-15 deferral premise is wrong.** It assumes the Svelte plan *deletes* `graph/chrome.js` and `auth-ui.js` rather than wrapping them | Unknown — neither survey read the Svelte component plan | High — the single largest swing factor in the design | **Confirm against the Svelte plan before committing to the ordering.** If those modules survive inside component shells, full strict before migration becomes the better call |
| **Vite silently breaks the plugin system.** `app/js/plugins.js:29` is a computed dynamic import; `app/thirdpartyrenderer/mermaid.js` imports back into `../js/blocks.js` and does `new URL('./mermaid.min.js', import.meta.url)` against a 3.5 MB gitignored file | Medium | High — failure is silent: the build machine's plugin set gets baked in, or a clean clone builds fine and the plugin never loads | `/* @vite-ignore */` plus static passthrough of the whole folder. **CI smoke test that builds with `app/thirdpartyrenderer/` EMPTY and asserts the app boots** — that is the clean-clone case and nobody hits it locally. **Half-day spike before the Vite commit is planned; this is the highest-risk unknown in the toolchain** |
| **Merge conflicts with in-flight work.** A JSDoc sweep edits the comment block immediately above every function signature — the most conflict-prone region — and `git status` shows **18 modified/untracked `app/js/` files right now**, which are exactly the worst-offender set | **High** | Medium | Sequence steps 2–8 by *file cluster* and land each as its own commit series, so a conflict is confined to one subsystem. Land step 0 immediately and independently. Accept this cost explicitly — it is the price of the ordering, and the loser plan's strongest objection |
| **Serving `.ts` or `.map` wrong.** Windows `mimetypes` resolves `.map` to `text/plain` and `.ts` to `video/vnd.dlna.mpeg-tts`. Worse, the shell is ungated by design, so an inlined-`sourcesContent` map publishes the whole TS source to anonymous visitors | Medium | Medium (High for an internet-facing instance) | Build **into** `app/` from a `src/` outside the served root, so raw `.ts` never reaches `APP_DIR` at all. Add the `.map` `CONTENT_TYPES` entry. Use `sourcemap: 'hidden'` for anything internet-facing with auth on |
| **`$state` in a plain `.ts` file.** Silently non-reactive — no error, no warning, the app degrades in ways that look like unrelated UI bugs. Bites in the busiest wave | Medium | High | **One-line CI grep** asserting no plain `.ts` under `src/` contains `$state(`, `$derived(` or `$effect(`. A failure mode this silent needs a check, not a note |
| **Mistaking the permissive measurement for the real one.** The headline "581 → 242" was measured by substituting `Record<string, any>` — an *upper* bound | Medium | Low, but it makes step 2 look overrun when it is not | Quote the ESTIMATED landing zone as **260–300**, not 242. State inline that the 58% is directional |
| **The new wire types become the next unchecked contract.** Step 6 writes TS interfaces asserting what a Python stdlib server returns, with no shared schema and no verification — structurally the same setup that let the JSDoc drift | Medium | Medium | **Read the `serve.py` handlers while writing them**, not just the client consumption sites. One parse/guard per endpoint family so a mismatch surfaces at the boundary rather than three modules downstream. Cross-reference from `docs/reference/config.md` |
| **A wave balloons because type work and component work cannot be separated once they are in one commit.** The graph wave is ~2,200 lines and contains both the hardest type problem and a canvas-to-component boundary | Medium | Medium — if it stops being reviewable it gets merged unreviewed, forfeiting the plan's central claim | A wave is a **scheduling** unit, not a PR unit. Open a PR per module. The atomicity rule binds a single module's rename + typing + componentisation, not a whole subsystem |
| **Treating the measured numbers as config-independent.** All counts assume `target: ES2022`, `lib: ES2022+DOM+DOM.Iterable`, `moduleResolution: Bundler`, `skipLibCheck: true` | Low | Low | They are a **planning baseline, not a specification.** A lower target loses `.flat`/`??=`/`at()` and adds errors; adding Svelte's ambient types changes them again |
| **`svelte-check`'s TypeScript peer range moves.** `svelte-check@4.7.6` declares `typescript: "^5.0.0 \|\| ^6.0.0"`; `npm i -D typescript` installs 7.0.2 | Medium | Medium | Re-run `npm view svelte-check peerDependencies` at implementation time — **it is the number most likely to have moved.** Add a CI assertion on the resolved TypeScript version |
