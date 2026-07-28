// catalog.js - client-side discovery and document loading.
// The server is a dumb file server: it lists directories as JSON and serves
// files. Everything about "what documents exist" and "what they contain" is
// worked out here, in the browser.

/**
 * One entry of site.json's `sources` array, describing a doc source folder;
 * different consumers read different subsets of its fields (url for
 * crawling, component for requirement-id prefixing, testResults for xUnit
 * discovery). This is the canonical definition - referenced elsewhere via a
 * type-only import.
 * @typedef {Object} SourceConfig
 * @property {string} name
 * @property {string} url
 * @property {string} [component]
 * @property {string} [testResults]
 */

/**
 * The parsed contents of /site.json.
 * @typedef {Object} SiteConfig
 * @property {string} siteTitle
 * @property {string} defaultDoc
 * @property {string} [theme]
 * @property {SourceConfig[]} sources
 */

/**
 * The canonical in-memory document record: starts as a bare directory-listing
 * stub (discover()/makeDoc(), mirrored by app-shell.js's docFromId) and is
 * filled in with parsed metadata/body by loadDoc(); this is the shape almost
 * everything else in the app (graph, links, requirements, reader, editor) is
 * keyed on. This is the canonical definition - referenced elsewhere via a
 * type-only import.
 * @typedef {Object} Doc
 * @property {string} id
 * @property {string} source
 * @property {string} rel
 * @property {string} url
 * @property {string} name
 * @property {Object<string, *>} [meta] - raw parsed frontmatter
 * @property {string} [body]
 * @property {string|null} [metaError]
 * @property {string} [title]
 * @property {string} [description]
 * @property {string[]} [assumes]
 * @property {string[]} [next]
 * @property {boolean} [_loaded]
 */

/** @returns {Promise<SiteConfig>} */
export async function loadSite() {
  const res = await fetch('/site.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load /site.json (' + res.status + ')');
  return res.json(); // { siteTitle, defaultDoc, theme, sources:[{name,url}] }
}

/**
 * Walk every source folder, collecting .md files. Returns a flat list of
 * bare-stub Docs (id/source/rel/url/name only, no content yet).
 * @param {SourceConfig[]} sources
 * @returns {Promise<Doc[]>}
 */
export async function discover(sources) {
  const docs = [];
  for (const src of sources) {
    await walk(src.name, src.url, docs);
  }
  docs.sort((a, b) => a.id.localeCompare(b.id));
  return docs;
}

/**
 * @param {string} sourceName
 * @param {string} url - directory-listing URL to fetch
 * @param {Doc[]} out - accumulator array, pushed into as .md files are found
 * @returns {Promise<void>}
 */
async function walk(sourceName, url, out) {
  let listing;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return;
    listing = await res.json();
  } catch (e) {
    return;
  }
  for (const entry of listing.entries || []) {
    if (entry.type === 'dir') {
      await walk(sourceName, entry.url, out);
    } else if (/\.md$/i.test(entry.name)) {
      out.push(makeDoc(sourceName, entry.url, entry.name));
    }
  }
}

/**
 * Builds a bare-stub Doc (no meta/body yet - see loadDoc) from a directory
 * listing entry.
 * @param {string} sourceName
 * @param {string} url
 * @param {string} name
 * @returns {Doc}
 */
function makeDoc(sourceName, url, name) {
  // url = /docs/<Source>/<rel...>.md  -> id = <Source>/<rel...>  (no extension)
  let rel = decodeURIComponent(url.replace(/^\/docs\//, ''));
  const id = rel.replace(/\.md$/i, '');
  return { id, source: sourceName, rel, url, name };
}

// Split a raw file into { meta, body }. The metadata is a JSON object wrapped
// in an HTML comment: <!--meta { ... } -->  at the very top of the file.
const META_RE = /^﻿?\s*<!--\s*meta\b([\s\S]*?)-->\s*/i;

/**
 * @param {string} text - raw file contents
 * @returns {{meta: Object<string, *>, body: string, metaError: string|null}}
 */
export function splitMeta(text) {
  const m = text.match(META_RE);
  if (!m) return { meta: {}, body: text, metaError: null };
  let meta = {}, metaError = null;
  try {
    meta = JSON.parse(m[1].trim());
  } catch (e) {
    metaError = String(e && e.message || e);
  }
  return { meta, body: text.slice(m[0].length), metaError };
}

/**
 * Fetch a single document's text and parse its metadata. Caches on the doc
 * (mutates and returns the same object; a no-op if already loaded).
 * @param {Doc} doc
 * @returns {Promise<Doc>}
 */
export async function loadDoc(doc) {
  if (doc._loaded) return doc;
  const res = await fetch(doc.url, { cache: 'no-cache' });
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
  doc._loaded = true;
  return doc;
}

/**
 * @param {Doc} doc
 * @returns {string}
 */
function fallbackTitle(doc) {
  const base = doc.name.replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
  return base.replace(/\b\w/g, c => c.toUpperCase());
}
