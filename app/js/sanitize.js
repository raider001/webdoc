// sanitize.js - allowlist HTML sanitizer.
// Embedded HTML is allowed, but ALL styling and scripting is rejected.
// This is a policy layer that runs AFTER Markdown parsing and BEFORE the
// content reaches the live DOM. Parsing happens in an inert document (via
// DOMParser) so scripts never run and resources never load during cleaning.

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code', 'span',
  'ul', 'ol', 'li',
  'a', 'img',
  'em', 'strong', 'del', 'ins', 'sub', 'sup', 'mark', 'b', 'i',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'figcaption', 'div',
  'details', 'summary', // collapsible disclosure (open attr allowed below)
  'input' // only a disabled checkbox survives (task lists) - enforced below
]);

// Tags whose entire subtree is discarded.
const DROP_SUBTREE = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
  'form', 'button', 'select', 'option', 'textarea', 'svg', 'math', 'template',
  'title', 'noscript', 'audio', 'video', 'source', 'track', 'canvas'
]);

const EMPTY = new Set();

const ALLOWED_ATTRS = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title']),
  input: new Set(['type', 'checked', 'disabled']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  details: new Set(['open'])
};

const SAFE_URL = /^(https?:|mailto:|tel:|\/|\.\/|\.\.\/|#)/i;

/**
 * Whether a URL is safe to keep on an href/src attribute: allows relative/
 * hash forms and an explicit http(s)/mailto/tel allowlist, and rejects any
 * other explicit scheme (e.g. "javascript:", "data:") after stripping
 * control characters/whitespace that could otherwise hide a scheme.
 * @param {string} value
 * @returns {boolean}
 */
function safeUrl(value) {
  // Remove control chars / whitespace that can hide a scheme (e.g. "java\tscript:").
  const v = String(value).replace(/[\u0000-\u0020\u007f-\u009f]+/g, '').trim();
  if (SAFE_URL.test(v)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return false; // any other explicit scheme -> reject
  return true; // relative path, no scheme
}

/**
 * Replace `el` with its own children (used for elements that are unknown but
 * harmless, so their content is kept while the wrapping tag itself is
 * discarded).
 * @param {Element} el
 * @returns {void}
 */
function unwrap(el) {
  const parent = el.parentNode;
  if (!parent) { el.remove(); return; }
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/**
 * Enforce the allowlist policy on a single element in place: drop
 * disallowed tags' whole subtree, unwrap unknown-but-harmless tags, strip
 * any attribute not on that tag's ALLOWED_ATTRS list (plus every `on*`
 * handler and unsafe href/src URL), narrow a surviving `class` down to a
 * single language-* highlighting hint on code/pre, force any surviving
 * checkbox `input` to `disabled`, and add `rel="noopener nofollow ugc"` to
 * links. Assumes `el`'s children have already been scrubbed (see walk).
 * @param {Element} el
 * @returns {void}
 */
function scrubElement(el) {
  const tag = el.tagName.toLowerCase();

  if (DROP_SUBTREE.has(tag)) { el.remove(); return; }

  if (!ALLOWED_TAGS.has(tag)) { unwrap(el); return; } // unknown but harmless -> keep children

  if (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() !== 'checkbox') {
    el.remove(); return;
  }

  const allowed = ALLOWED_ATTRS[tag] || EMPTY;
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name === 'class') {
      // Narrow exception: keep a single language-* hint on code/pre so the
      // syntax highlighter knows the grammar; strip every other class,
      // everywhere. This is a semantic hint, not a styling hook - authors
      // still cannot supply CSS, so "styling is rejected" holds.
      const lang = attr.value.split(/\s+/).find(c => /^language-[\w+.#-]+$/i.test(c));
      if ((tag === 'code' || tag === 'pre') && lang) el.setAttribute('class', lang.toLowerCase());
      else el.removeAttribute('class');
      continue;
    }
    if (name.startsWith('on') || !allowed.has(name)) { el.removeAttribute(attr.name); continue; }
    if ((name === 'href' || name === 'src') && !safeUrl(attr.value)) el.removeAttribute(attr.name);
  }

  if (tag === 'input') el.setAttribute('disabled', '');
  if (tag === 'a' && el.getAttribute('href')) el.setAttribute('rel', 'noopener nofollow ugc');
}

/**
 * Depth-first sanitize pass over a live (inert-document) subtree: recurses
 * into an element's children and scrubs each one (see scrubElement) only
 * after its own children are already clean, and drops comment nodes
 * outright.
 * @param {Node} node
 * @returns {void}
 */
function walk(node) {
  // Depth-first: scrub children before the element, so unwrap keeps clean subtrees.
  let child = node.firstChild;
  while (child) {
    const next = child.nextSibling;
    if (child.nodeType === 1) {        // element
      walk(child);
      scrubElement(child);
    } else if (child.nodeType === 8) { // comment
      child.remove();
    }
    child = next;
  }
}

/**
 * Parse an HTML string inertly (via DOMParser, so scripts never run and
 * resources never load), sanitize it against the allowlist policy above,
 * and return a DocumentFragment ready to append to the live document.
 * @param {string} html
 * @returns {DocumentFragment}
 */
export function sanitizeToFragment(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  walk(doc.body);
  const frag = document.createDocumentFragment();
  while (doc.body.firstChild) frag.appendChild(doc.body.firstChild);
  return frag;
}
