// The single Vite entry. Everything the browser can mount or call is re-exported
// from here, and app/js/islands.js is the only thing that imports the built
// result.
//
// Keep this a pure export surface: no side effects, no top-level DOM work. It is
// loaded lazily, and anything running at import time would run at a moment the
// shell did not choose.
// flushSync is exported because the vanilla shell genuinely needs it, and this
// is the phase's easiest silent failure. reader.js's setupScrollSpy reads
// tocList.querySelectorAll('a[data-target]') in the SAME TICK the TOC is set,
// but rune writes are applied in a microtask. Without a flush the query
// returns nothing, no TOC entry is ever marked .active, and nothing throws.
export { mount, unmount, flushSync } from 'svelte';

// Phase 1's proof-of-toolchain island. Nothing imports it; it is kept because
// tests/test_build_externals.py asserts the bundle keeps a live external import
// of /js/icons.js, and this is the smallest component that has one.
export { default as NoOp } from './NoOp.svelte';

// Phase 3 - the drawer tree and search results.
export { mountDocTree, mountSearchHits } from './islands/tree.js';
export { setActive, invalidateTree } from './stores/tree.svelte.js';
export { beginSearch, showHits } from './stores/search.svelte.js';

// Phase 4 - the reading view's satellites: breadcrumb, TOC, footer link groups.
// The three mounts run once at boot; the three setters are what a navigation
// calls.
export { mountToc, mountCrumbs, mountFooter } from './islands/reader.js';
export { setCrumbs, setToc, setFootLinks } from './stores/shell.svelte.js';

// Phase 5 - the account screens. No store setter is exported: the session lives
// in app/js/auth.js, which is unchanged, and stores/auth.svelte.js only MIRRORS
// it through onAuthChange. There is deliberately no way for the vanilla shell to
// push an identity into the bundle, because there is only one identity and
// auth.js owns it.
export {
  mountSignInWall, mountAccountButton, openAccountPanel, openAdminPanel,
  mountRestrictedPage, mountRestrictedSection, mountGroupChip,
} from './islands/auth.js';

// Phase 6 - the requirement tables and test-case blocks that render INSIDE the
// article. Unlike every island above, these return a teardown handle and the
// caller is obliged to keep it: their hosts are placeholders in a document body
// that is rebuilt on every navigation. See app/svelte/islands/requirements.js.
export { mountReqTable, mountTestCase } from './islands/requirements.js';

// Phase 7 - the two full-screen test surfaces. Both return a teardown handle
// and both callers must keep it: a coverage view left mounted while hidden keeps
// a canvas rAF loop and window.__graph alive. See app/svelte/islands/coverage.js.
export { mountCoverageOverlay, mountRunner } from './islands/coverage.js';

// Phase 8 - the document map. Same handle discipline as the coverage overlay,
// and for the same reason. The second export is the seam the other way round:
// the map's data is fetched by the vanilla shell (app/js/map-view.js, driven by
// app/js/overlays.js's requestMapRebuild) and pushed in, because the module that
// knows a rebuild is worth paying for is the one that stayed outside the bundle.
export { mountMapOverlay, setMapModel } from './islands/map.js';

// Phase 6 groundwork - the coverage-status bridge, ahead of the components that
// use it. Only the SUBSCRIBE side is exported, never the rune: coverage data
// still lives in app/js/requirements/store.js, and handing the vanilla shell a
// $state proxy would offer it a second, meaningless place to ask about status.
//
// Exported now rather than left internal (startAuthSync, its Phase 5 analogue,
// is not exported) for two reasons. It is what puts stores/coverage.svelte.js
// into the bundle graph at all - an unreferenced module is tree-shaken away, and
// with it the external `/js/requirements/store.js` import that proves the seam
// is wired the right way round. And it lets the shell start the tick at boot,
// before the first badge is mounted, so no status change can be missed in the
// gap. islands/coverage.js will be its ordinary caller once it exists.
export { startCoverageSync } from './stores/coverage.svelte.js';
