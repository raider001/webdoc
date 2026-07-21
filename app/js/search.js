// search.js - all-documents search over document titles + headings.
// ---------------------------------------------------------------------------
// Light by design: it indexes each document's title and its ATX headings (not
// full body text), built once at boot from the already-loaded doc bodies. No
// third-party dependency; a plain substring match, ranked title-first.
// ---------------------------------------------------------------------------

const idx = []; // [{ docId, title, titleLC, headings:[{text, lc}] }]

// Pull ATX headings from a body, skipping code fences and requirement blocks.
function extractHeadings(body) {
  let s = String(body || '');
  s = s.replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, ''); // fenced code
  s = s.replace(/<!--\s*meta\s+start[\s\S]*?<!--\s*meta\s+end\b[\s\S]*?-->/gi, ''); // requirement groups
  const heads = [];
  const re = /^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm;
  let m;
  while ((m = re.exec(s)) !== null) {
    const text = m[1].replace(/[*_`~]/g, '').trim(); // strip simple inline markdown
    if (text) heads.push(text);
  }
  return heads;
}

export function buildSearchIndex(docs) {
  idx.length = 0;
  for (const doc of docs || []) {
    const title = doc.title || doc.id;
    idx.push({
      docId: doc.id,
      title: title,
      titleLC: title.toLowerCase(),
      headings: extractHeadings(doc.body).map(h => ({ text: h, lc: h.toLowerCase() }))
    });
  }
}

// Returns [{ docId, title, titleHit, headings:[text], score }], ranked title-first.
export function searchDocs(query, limit) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const results = [];
  for (const e of idx) {
    const titleHit = e.titleLC.indexOf(q) !== -1;
    const headingHits = e.headings.filter(h => h.lc.indexOf(q) !== -1).map(h => h.text);
    if (titleHit || headingHits.length) {
      results.push({
        docId: e.docId, title: e.title, titleHit: titleHit,
        headings: headingHits, score: (titleHit ? 100 : 0) + headingHits.length
      });
    }
  }
  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return limit ? results.slice(0, limit) : results;
}
