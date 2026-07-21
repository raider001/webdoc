// catalog.js - client-side discovery and document loading.
// The server is a dumb file server: it lists directories as JSON and serves
// files. Everything about "what documents exist" and "what they contain" is
// worked out here, in the browser.

export async function loadSite() {
  const res = await fetch('/site.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load /site.json (' + res.status + ')');
  return res.json(); // { siteTitle, defaultDoc, theme, sources:[{name,url}] }
}

// Walk every source folder, collecting .md files. Returns a flat list of
// { id, source, rel, url, name } with no content yet.
export async function discover(sources) {
  const docs = [];
  for (const src of sources) {
    await walk(src.name, src.url, docs);
  }
  docs.sort((a, b) => a.id.localeCompare(b.id));
  return docs;
}

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

function makeDoc(sourceName, url, name) {
  // url = /docs/<Source>/<rel...>.md  -> id = <Source>/<rel...>  (no extension)
  let rel = decodeURIComponent(url.replace(/^\/docs\//, ''));
  const id = rel.replace(/\.md$/i, '');
  return { id, source: sourceName, rel, url, name };
}

// Split a raw file into { meta, body }. The metadata is a JSON object wrapped
// in an HTML comment: <!--meta { ... } -->  at the very top of the file.
const META_RE = /^﻿?\s*<!--\s*meta\b([\s\S]*?)-->\s*/i;

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

// Fetch a single document's text and parse its metadata. Caches on the doc.
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

function fallbackTitle(doc) {
  const base = doc.name.replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
  return base.replace(/\b\w/g, c => c.toUpperCase());
}
