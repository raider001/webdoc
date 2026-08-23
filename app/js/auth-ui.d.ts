import type { RestrictedDetail } from './catalog.js';
/**
 * A coloured chip naming one access group. The single place a group is drawn, so
 * the map legend, the locked-page screen and the admin list all agree.
 *
 * RETURNS THE HOST, not the chip inside it. That is the whole contract: the host
 * is what identifies the instance, so returning host.firstElementChild would
 * throw away Svelte's anchor node and the handle with it - the component could
 * then never be unmounted and would never update. Callers append the host and
 * pass that same host back to destroyGroupChip().
 *
 * The mount is asynchronous because the bundle is loaded lazily and there is no
 * synchronous way to import it. In practice it has already been loaded by boot,
 * so the chip appears in the next microtask.
 */
export declare function groupChip(name: string, opts?: {
    small?: boolean;
    title?: string;
}): HTMLElement;
/**
 * Destroy the chip mounted in `host` - the element groupChip() returned. Call it
 * before dropping the host: the editor redraws its chip rows on every checkbox
 * change, and a cleared container detaches nodes without stopping the components
 * inside them.
 */
export declare function destroyGroupChip(host: Element): void;
/**
 * Put up the full-screen sign-in / registration screen. `target` is normally
 * document.body.
 *
 * `onSignedIn` fires once, after the wall has already been removed. On a server
 * that allows neither sign-in nor registration (registration closed, no account)
 * it simply stays up, which is the correct end state.
 *
 * NOT a modal. `.auth-wall` has no Escape handler and no scrim click, unlike the
 * dialogs below - boot() is suspended behind this screen, and dismissing it would
 * drop the visitor onto an empty shell that then fires library fetches the server
 * refuses one at a time.
 */
export declare function mountSignInWall(target: Element, opts: {
    onSignedIn: () => void;
}): void;
/**
 * The promise-shaped form of mountSignInWall, for the two places that continue
 * with `.then(() => location.reload())`. Resolves once the visitor is signed in.
 *
 * A wall that is ALREADY up resolves immediately rather than queueing a second
 * waiter - the behaviour of the screen this replaces.
 */
export declare function showSignInWall(): Promise<void>;
/**
 * Wire the header account button: it shows who is signed in, and opens the
 * account panel. Hidden entirely when the server has accounts switched off, so a
 * server without auth looks exactly as it did before.
 *
 * The button's CONTENTS are an island; its `hidden`, `title`, `aria-label` and
 * click handler stay here, because a component cannot set attributes on the
 * element it was mounted into - and because the signed-out branch of the click
 * ends in a reload that must not move into the bundle.
 */
export declare function setupAccountButton(): void;
export declare function openAccountPanel(): void;
export declare function openAdminPanel(): void;
/**
 * What a reader sees INSTEAD of a document they may not open. `detail` is the
 * server's own explanation, exactly as catalog.ts's RestrictedError carried it.
 *
 * Returns the host straight away so the caller can put it where the article was;
 * the component mounts into it a microtask later. The mount is registered with
 * reader.ts through the app registry (not by importing reader.ts, which imports
 * this file) so the next navigation tears it down.
 */
export declare function restrictedPanel(docId: string, detail: RestrictedDetail): HTMLElement;
/**
 * What the server left behind in place of a section this reader may not see: the
 * groups that would have opened it, the section's label, and the `malformed`
 * flag it sets when the marker itself could not be parsed. A type alias rather
 * than an interface so it still reads as the plain JSON record the island takes.
 */
export type RestrictedSectionSpec = {
    read?: string[];
    label?: string;
    malformed?: boolean;
};
/**
 * The notice that replaces a section this reader may not see. The SERVER has
 * already removed the content; this only renders the hole it left.
 */
export declare function restrictedSection(spec: RestrictedSectionSpec): HTMLElement;
/**
 * Re-run whatever depends on the signed-in identity. Exported so main.ts can
 * hook the header up without importing the internals.
 */
export declare function wallNeeded(): boolean;
