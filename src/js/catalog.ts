// catalog.ts - site config and document loading.
// The server owns "what documents exist": the tree, search and map are all fed
// by its /api/index/* endpoints. All that is left here is the two fetches the
// browser still makes for itself - /site.json at boot, and one document's text
// on demand (whose <!--meta--> header is split off client-side).

import { errorMessage } from './errors.js';

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

export async function loadSite(): Promise<SiteConfig> {
  const res = await fetch('/site.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load /site.json (' + res.status + ')');
  return res.json(); // { siteTitle, defaultDoc, theme, sources:[{name,url}] }
}

// Split a raw file into { meta, body }. The metadata is a JSON object wrapped
// in an HTML comment: <!--meta { ... } -->  at the very top of the file.
const META_RE = /^﻿?\s*<!--\s*meta\b([\s\S]*?)-->\s*/i;

/**
 * @param text - raw file contents
 */
export function splitMeta(text: string): { meta: DocMeta, body: string, metaError: string | null } {
  const m = text.match(META_RE);
  if (!m) return { meta: {}, body: text, metaError: null };
  let meta: DocMeta = {}, metaError: string | null = null;
  try {
    meta = JSON.parse(m[1].trim());
  } catch (e) {
    metaError = String(e && errorMessage(e) || e);
  }
  return { meta, body: text.slice(m[0].length), metaError };
}

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
export class RestrictedError extends Error {
  readonly restricted: true = true;
  readonly detail: RestrictedDetail;
  constructor(message: string, detail: RestrictedDetail) {
    super(message);
    this.detail = detail;
  }
}

/**
 * Narrow a caught value to the refusal above. Written as a duck-type test on
 * `restricted` rather than `instanceof`, because that is what the untyped
 * callers already do and because an error that crossed a module boundary is not
 * guaranteed to be an instance of THIS realm's class.
 */
export function isRestrictedError(e: unknown): e is RestrictedError {
  return !!e && typeof e === 'object' && (e as RestrictedError).restricted === true;
}

/**
 * Fetch a single document's text and parse its metadata. Caches on the doc
 * (mutates and returns the same object; a no-op if already loaded).
 *
 * Throws a RestrictedError when the server refuses the document (401/403).
 */
export async function loadDoc(doc: Doc): Promise<Doc> {
  if (doc._loaded) return doc;
  const res = await fetch(doc.url, { cache: 'no-cache', credentials: 'same-origin' });
  if (res.status === 401 || res.status === 403) {
    // Restricted, not missing. Carry the server's explanation (which groups would
    // open it, whether signing in would help) on the error so the router can show
    // the reader something useful instead of "not found".
    let detail: RestrictedDetail = {};
    try { detail = await res.json(); } catch (e) { detail = {}; }
    throw new RestrictedError('Restricted: ' + doc.id, detail);
  }
  if (!res.ok) throw new Error('Document not found: ' + doc.id);
  const text = await res.text();
  const { meta, body, metaError } = splitMeta(text);
  doc.meta = meta || {};
  doc.body = body;
  doc.metaError = metaError;
  doc.title = (meta && meta.title) || fallbackTitle(doc);
  doc.description = (meta && meta.description) || '';
  doc.assumes = (meta && meta.assumes) || [];
  doc.next = (meta && meta.next) || [];
  // A CONTENT revision counter, bumped here because this is the one place a
  // Doc's body is (re)assigned. It exists because loadDoc mutates the record IN
  // PLACE: the same object, with the same `id`, comes back holding different
  // text, so a Svelte `{#key doc.id}` around the article would see no change and
  // keep the stale render. `{#key doc._rev}` (or `doc.id + ':' + doc._rev`) is
  // what actually re-keys. The two call paths that re-read an ALREADY-rendered
  // doc - both clear `_loaded` first, precisely so this line runs again - are:
  //   1. main.js onExternalChange() - the /api/index/status generation poll, i.e.
  //      a file edited outside the app (text editor, git pull, another browser).
  //   2. authoring.js refreshCatalog() - after the in-app editor saves, deletes
  //      or re-links, which is also what the after-a-test-run refresh runs through.
  // NOTE the case this deliberately does NOT cover: main.js's setupTestRun()
  // onSaved re-renders state.current WITHOUT reloading it (the body did not
  // change - only pass/fail did), so _rev is unchanged there by design. Repainting
  // those badges is the coverage rune store's job, not this counter's.
  doc._rev = (doc._rev || 0) + 1;
  doc._loaded = true;
  return doc;
}

function fallbackTitle(doc: Doc): string {
  const base = doc.name.replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
  return base.replace(/\b\w/g, c => c.toUpperCase());
}
