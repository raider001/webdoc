/**
 * Write `text` into the polite live region, replacing whatever it held.
 * `text` is the message to speak; '' clears the region.
 *
 * Two judgement calls, both about preserving what the 13 migrated call sites
 * already did:
 *   - `text` is written as given, with NO truthiness check. Several callers are
 *     on error paths and some pass a deliberately empty string to CLEAR the
 *     region; `announce('')` must therefore still clear it, not become a no-op.
 *   - The missing-element guard is not defensive habit. The boot-failure handler
 *     in main.ts already carried it, because it runs when the shell's own markup
 *     may be the thing that is broken and must not throw a second time inside a
 *     catch block. That guard moves in here with the write it belonged to, so no
 *     caller can reintroduce the crash it was protecting against.
 */
export declare function announce(text: string): void;
