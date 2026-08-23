// highlighter.js - a small, hand-written, zero-dependency syntax highlighter.
// ---------------------------------------------------------------------------
// Runs AFTER the sanitizer, over the already-inert DOM. For every
// <pre> > <code> it reads the "language-xxx" hint the sanitizer preserved,
// tokenizes the code element's TEXT CONTENT with a tiny per-language state
// machine (see ./highlight/grammars.js, built on ./highlight/lexer.js), and
// rebuilds the element's children as text nodes + typed <span class="tok-...">
// using DOM APIs only (never innerHTML). Every tokenizer runs unterminated
// strings/comments safely to end-of-input, and the whole pass is wrapped so a
// surprise in one block can never throw.
//
// All grammars are written from scratch from my own understanding of each
// language; token names, structure and patterns are original to this project
// and are not ported from any existing highlighter.
// ---------------------------------------------------------------------------
import { merge } from './highlight/lexer.js';
import {
  pythonTokens, javaTokens, shellTokens, makefileTokens, robotTokens, genericTokens
} from './highlight/grammars.js';

/** @typedef {import('./highlight/lexer.js').HighlightToken} HighlightToken */

/** One per-language tokenizer function, as exported by ./highlight/grammars.js. @typedef {(src: string) => HighlightToken[]} HighlightTokenizer */

// ---- registry + DOM emit --------------------------------------------------

/** @type {Object<string, HighlightTokenizer>} */
const LANGS = {
  python: pythonTokens, py: pythonTokens,
  robotframework: robotTokens, robot: robotTokens,
  makefile: makefileTokens, make: makefileTokens, mk: makefileTokens,
  shell: shellTokens, sh: shellTokens, bash: shellTokens,
  console: shellTokens, zsh: shellTokens,
  java: javaTokens
};

/**
 * Reads the "language-xxx" hint off a <code> element's class list (as
 * preserved by the sanitizer).
 * @param {HTMLElement} code
 * @returns {string|null}
 */
function langOf(code) {
  const cls = code.getAttribute('class') || '';
  const m = /(?:^|\s)language-([\w+.#-]+)/i.exec(cls);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Replaces a <code> element's children with text nodes + typed
 * <span class="tok-...">, one per token (DOM APIs only, never innerHTML).
 * @param {HTMLElement} code
 * @param {HighlightToken[]} toks
 * @returns {void}
 */
function rebuild(code, toks) {
  code.textContent = '';
  for (const t of toks) {
    if (!t.type) {
      code.appendChild(document.createTextNode(t.text));
    } else {
      const span = document.createElement('span');
      span.className = 'tok-' + t.type;
      span.textContent = t.text;
      code.appendChild(span);
    }
  }
}

/**
 * Public entry point. Highlights every <pre> > <code> under `root`.
 * Unknown languages fall back to a generic pass; code with no language hint
 * is left untouched. Never throws.
 * @param {Element|Document} root
 * @returns {void}
 */
export function highlightWithin(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  let codes;
  // A `pre > code` match is always an HTML element; the selector is too compound
  // for the checker to work that out for itself.
  try { codes = /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('pre > code')); }
  catch (e) { return; }
  codes.forEach(code => {
    try {
      if (code.dataset && code.dataset.hl === '1') return;
      const lang = langOf(code);
      const tokenizer = lang ? (LANGS[lang] || genericTokens) : null;
      if (!tokenizer) return;            // no hint -> leave the block as-is
      const src = code.textContent;
      if (!src) return;
      rebuild(code, merge(tokenizer(src)));
      if (code.dataset) code.dataset.hl = '1';
    } catch (e) { /* one bad block must never break the page */ }
  });
}
