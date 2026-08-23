// announce.js - the single owner of #live, the app's ARIA live region
// (<div id="live" class="visually-hidden" aria-live="polite"> in index.html).
// Before this module, five feature modules each reached for the element by id
// and assigned .textContent; the region is a shared, screen-reader-visible
// surface, so it gets one writer the way any shared surface should.
//
// WHY THIS STAYS A PLAIN VANILLA MODULE, and is not a Svelte island or store:
//   - authoring.js and map-view.js are hand-written vanilla and must be able to
//     announce WITHOUT importing anything compiled. Routing their announcements
//     through the bundle would pull the framework into paths that have no other
//     reason to load it, and would put a build step between an error message and
//     the user hearing it.
//   - A live region whose contents are re-rendered by a framework is a
//     well-known screen-reader hazard: a reactive re-render can retrigger an
//     announcement the reader already spoke, or replace the node fast enough
//     that the reader never picks the text up at all. One imperative write, at
//     the moment the caller has something to say, is the behaviour we want and
//     the only behaviour that is reliable across readers.
//
// Deliberately tiny: no queue, no debounce, no politeness API. Each of those
// would CHANGE when (or whether) something is announced, and nothing here needs
// them - callers announce one short sentence at a human-paced moment.

import { el } from './app-shell.js';

/**
 * Write `text` into the polite live region, replacing whatever it held.
 *
 * Two judgement calls, both about preserving what the 13 migrated call sites
 * already did:
 *   - `text` is written as given, with NO truthiness check. Several callers are
 *     on error paths and some pass a deliberately empty string to CLEAR the
 *     region; `announce('')` must therefore still clear it, not become a no-op.
 *   - The missing-element guard is not defensive habit. The boot-failure handler
 *     in main.js already carried it, because it runs when the shell's own markup
 *     may be the thing that is broken and must not throw a second time inside a
 *     catch block. That guard moves in here with the write it belonged to, so no
 *     caller can reintroduce the crash it was protecting against.
 *
 * @param {string} text - the message to speak; '' clears the region
 * @returns {void}
 */
export function announce(text) {
  const live = el('live');
  if (live) live.textContent = text;
}
