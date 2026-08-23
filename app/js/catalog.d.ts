/**
 * One entry of site.json's `sources` array, describing a doc source folder;
 * different consumers read different subsets of its fields (component for
 * requirement-id prefixing, testResults for xUnit discovery). This is the
 * canonical definition - referenced elsewhere via a type-only import.
 */
export interface SourceConfig {
    name: string;
    url: string;
    component?: string;
    testResults?: string;
}
/**
 * The parsed contents of /site.json - the boot payload, published
 * unauthenticated (serve.py's _site_json). `auth` carries POLICY only, never an
 * account and never a token, because the browser has to know whether to render
 * a sign-in wall before it is able to sign in; auth.js owns that shape, so it is
 * referenced here rather than redeclared.
 */
export interface SiteConfig {
    siteTitle: string;
    defaultDoc: string;
    theme?: string;
    /** renderer plugin ids; main.js hands these straight to plugins.js's loadPlugins */
    plugins?: string[];
    auth?: import('./auth.js').AuthPolicy;
    sources: SourceConfig[];
}
/**
 * A document's parsed `<!--meta-->` frontmatter. Authors may put arbitrary keys
 * in it (hence the `unknown`-valued base), so the fields declared here are only
 * the ones the application itself reads back out.
 */
export interface DocMeta extends Record<string, unknown> {
    title?: string;
    description?: string;
    assumes?: string[];
    next?: string[];
}
/**
 * The canonical in-memory document record: starts as a bare stub built from an
 * id (app-shell.js's docFromId) and is filled in with parsed metadata/body by
 * loadDoc(); this is the shape almost everything else in the app (graph, links,
 * requirements, reader, editor) is keyed on. This is the canonical definition -
 * referenced elsewhere via a type-only import.
 */
export interface Doc {
    id: string;
    source: string;
    rel: string;
    url: string;
    name: string;
    /** raw parsed frontmatter */
    meta?: DocMeta;
    body?: string;
    metaError?: string | null;
    title?: string;
    description?: string;
    assumes?: string[];
    next?: string[];
    _loaded?: boolean;
    /**
     * bumped by loadDoc every time the body is (re)read; see the comment at that
     * assignment for who needs it and why the id alone is not enough to tell two
     * renders of this object apart
     */
    _rev?: number;
}
export declare function loadSite(): Promise<SiteConfig>;
/**
 * @param text - raw file contents
 */
export declare function splitMeta(text: string): {
    meta: DocMeta;
    body: string;
    metaError: string | null;
};
/**
 * The server's explanation of a refusal, as carried on RestrictedError.detail:
 * which groups would open the document, and whether signing in would help. A
 * type alias rather than an interface on purpose - it is handed to consumers
 * (main.js's showRestricted, auth-ui.js's restrictedPanel) that still describe
 * it as a plain JSON record, and only an alias gets the implicit index
 * signature that keeps that assignment legal.
 */
export type RestrictedDetail = {
    /** any one of these groups would have opened it */
    requiresGroups?: string[];
    /** there is no session at all; signing in may be enough */
    signInRequired?: boolean;
    /** the server's own sentence, preferred when present */
    error?: string;
};
/**
 * What loadDoc throws on a 401/403: an ordinary Error with the server's
 * explanation attached, so a catch can tell "you may not read this" apart from
 * "no such document" (main.js's router branches on `.restricted`).
 *
 * A class, not a monkey-patched Error, because the two extra properties are the
 * whole point of the value and a caller has no other way to discover them. The
 * RUNTIME shape is deliberately unchanged from the hand-patched version it
 * replaces - `name` is left inherited as 'Error' so the message text and
 * `String(err)` read exactly as before, and `restricted` is still a plain own
 * property that a `.restricted` check in untyped code finds.
 */
export declare class RestrictedError extends Error {
    readonly restricted: true;
    readonly detail: RestrictedDetail;
    constructor(message: string, detail: RestrictedDetail);
}
/**
 * Narrow a caught value to the refusal above. Written as a duck-type test on
 * `restricted` rather than `instanceof`, because that is what the untyped
 * callers already do and because an error that crossed a module boundary is not
 * guaranteed to be an instance of THIS realm's class.
 */
export declare function isRestrictedError(e: unknown): e is RestrictedError;
/**
 * Fetch a single document's text and parse its metadata. Caches on the doc
 * (mutates and returns the same object; a no-op if already loaded).
 *
 * Throws a RestrictedError when the server refuses the document (401/403).
 */
export declare function loadDoc(doc: Doc): Promise<Doc>;
