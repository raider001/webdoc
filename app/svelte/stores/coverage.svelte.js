// coverage.svelte.js - a reactive TICK for the coverage-status map that
// app/js/requirements/store.js owns.
//
// This store holds NO coverage data. It cannot: the status map lives in a plain
// vanilla module because that module is reachable from index.html's native
// /js/main.js import, where a compile-time rune would be a syntax error in the
// browser (store.js's own header spells that out). So the data stays there, and
// only the fact that it CHANGED crosses into the bundle - as a counter.
//
// THE PATTERN EVERY COVERAGE COMPONENT DEPENDS ON, and the non-obvious part of
// this phase:
//
//   import { statusOf } from '/js/requirements/store.js';
//   import { covStatus } from '../stores/coverage.svelte.js';
//   ...
//   // BOTH reads must happen in the SAME expression.
//   const status = $derived((covStatus.version, statusOf(id)));
//
// statusOf() is an ordinary function call over an ordinary Map. Svelte cannot
// track it - nothing it touches is a rune - so a badge that only called
// statusOf() would render once and then be wrong forever. Reading
// covStatus.version alongside it puts a rune the effect CAN track into the same
// dependency set, so replacing the map re-runs the expression and every badge
// repaints on the spot. The comma operator is what keeps them in one expression
// while still yielding the status; the version number itself is never displayed
// and its actual value is meaningless - only that it differs from last time.
//
// WHY THIS MATTERS: the vanilla shell's answer to "coverage changed" is to call
// renderDoc(state.current) and rebuild the whole article. That throws away the
// scroll position, any open <details>, the find-in-page state and every mounted
// island in the document. With this counter the badges update and nothing else
// moves, which is the entire reason the article contract exists.
//
// The `.svelte.js` extension is required - it is what tells the compiler to
// process runes in a plain module rather than treat $state as an undefined name.
import { onStatusChange } from '/js/requirements/store.js';

/**
 * The tick itself. One field, deliberately: adding the map here would create a
 * second source of truth for something the vanilla coverage view still writes.
 * @type {{version: number}}
 */
export const covStatus = $state({ version: 0 });

// onStatusChange() DOES return an unsubscribe, but this store never calls it:
// the subscription is process-wide and lasts as long as the bundle is loaded,
// which is cheaper than reference-counting mounts and unmounts of badges that
// come and go with every navigation. The callback is one integer increment, so
// an idle subscription costs nothing measurable.
let subscribed = false;

/**
 * Start tracking coverage-status replacements. Called by each island entry point
 * that mounts something status-coloured, NOT at import time: this module lives
 * in a lazily loaded bundle, and a listener registered at import time would run
 * at a moment the shell did not choose. Idempotent - subscribing twice would
 * mean two version bumps per change, which is harmless but wasteful, and this
 * has to be safe to call from every entry point.
 * @returns {void}
 */
export function startCoverageSync() {
  if (subscribed) return;
  subscribed = true;
  // No initial pull. There is nothing to pull - the data is read on demand via
  // statusOf() - and the first render already sees whatever the map holds now.
  onStatusChange(() => { covStatus.version++; });
}
