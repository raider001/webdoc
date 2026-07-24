// blocks.js - pluggable fenced-block renderers (core, zero third-party).
// ---------------------------------------------------------------------------
// A registry that maps a fenced code block's info-string (its "language") to a
// renderer that turns the block's text into DOM - the extension point for
// diagram engines and other rich blocks (```mermaid, ```plantuml, ...).
//
// It runs AFTER the sanitizer, as a decoration stage in the render pipeline
// (like highlightWithin / renderRequirements), so a renderer builds trusted DOM
// directly. THIS FILE SHIPS NO RENDERERS and imports nothing third-party - the
// core stays pure hand-written vanilla JS. Renderers live in ../thirdpartyrenderer
// and register themselves when their plugin is loaded (see plugins.js).
//
// Graceful degradation is a CORE guarantee, not a per-plugin concern: if no
// renderer is registered for a language, or a renderer throws, or its
// bring-your-own library is absent, the block falls back to an ordinary code
// block (plus a small inert notice) and the application runs exactly as before.
//
// Because a third-party renderer turns *document text* into markup that may
// contain <script>, on* handlers or javascript: URLs, every rendered fragment
// is passed through a lightweight defensive scrub before it stays in the live
// DOM. This is intentionally narrower than sanitize.js (it must KEEP <svg> and
// its shape elements) - it is defence-in-depth over the plugin's own output.
// ---------------------------------------------------------------------------

import { elem } from './dom.js';

const registry = new Map(); // lang -> { render, label }

// Register a renderer for a fenced info-string. `render(source, ctx)` may return
// a Node/DocumentFragment, a Promise resolving to one (for libraries that load
// or parse asynchronously), or nothing at all if it fills `ctx.host` itself.
export function registerBlockRenderer(lang, render, opts = {}) {
  if (!lang || typeof render !== 'function') return;
  registry.set(String(lang).toLowerCase(), { render, label: opts.label || String(lang) });
}

export function hasBlockRenderer(lang) {
  return registry.has(String(lang || '').toLowerCase());
}

export function registeredBlockLangs() {
  return [...registry.keys()];
}

// The "language-xxx" hint the sanitizer preserved on the <code> element.
function langOf(code) {
  const cls = code.getAttribute('class') || '';
  const m = /(?:^|\s)language-([\w+.#-]+)/i.exec(cls);
  return m ? m[1].toLowerCase() : null;
}

// Defence-in-depth over renderer output: strip scripts, inline event handlers
// and script-y URLs, while leaving SVG shapes intact. Never allowed to throw.
function scrubRendered(container) {
  try {
    container.querySelectorAll('script').forEach(s => s.remove());
    container.querySelectorAll('*').forEach(el => {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
        if ((name === 'href' || name === 'xlink:href' || name === 'src' || name === 'formaction') &&
            /^\s*(javascript|vbscript|data:text\/html)/i.test(attr.value || '')) {
          el.removeAttribute(attr.name);
        }
      }
    });
  } catch (e) { /* scrubbing must never break rendering */ }
}

// Fallback: keep the author's source as a normal (highlightable) code block and
// prepend a small inert notice explaining why the diagram did not render.
function renderFallback(host, lang, label, source, err) {
  host.textContent = '';
  host.classList.add('block-render-failed');
  const reason = (err && err.message) ? ': ' + err.message : '';
  host.append(
    elem('div', 'block-render-note', (label || lang) + ' could not be rendered' + reason + ' — showing source.'),
    elem('pre', null, elem('code', { class: 'language-' + lang, text: source })));
}

function fill(host, node) {
  if (node && node.nodeType) host.appendChild(node); // else: renderer filled host itself
}

// Pipeline stage: replace every fenced block whose language has a registered
// renderer with that renderer's output. Runs after resolveLinks and before
// highlightWithin. Async renderers mount a placeholder host now and settle later.
export function renderBlocks(root, ctx = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  let codes;
  try { codes = root.querySelectorAll('pre > code'); }
  catch (e) { return; }

  Array.from(codes).forEach(code => {
    const lang = langOf(code);
    if (!lang) return;
    const entry = registry.get(lang);
    if (!entry) return;                       // not a plugin language -> leave for the highlighter
    const pre = code.parentElement;
    if (!pre || pre.tagName !== 'PRE' || !pre.parentNode) return;

    const source = code.textContent;
    const host = elem('div', { class: 'block-render', 'data-block-lang': lang });
    pre.replaceWith(host);                     // host is in the DOM before render (libs may measure layout)

    let out;
    try {
      out = entry.render(source, Object.assign({ lang, host, pre, source }, ctx));
    } catch (e) {
      renderFallback(host, lang, entry.label, source, e);
      return;
    }

    if (out && typeof out.then === 'function') {
      out.then(node => { fill(host, node); scrubRendered(host); })
         .catch(e => renderFallback(host, lang, entry.label, source, e));
    } else {
      fill(host, out);
      scrubRendered(host);
    }
  });
}
