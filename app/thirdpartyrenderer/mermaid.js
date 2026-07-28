// thirdpartyrenderer/mermaid.js - facade around the third-party Mermaid library.
// ===========================================================================
// This is NOT core code. It is a thin translation wrapper that adapts an
// EXTERNAL renderer (Mermaid) to the core block-renderer contract in
// ../js/blocks.js. The core ships no third-party code; this facade lives in the
// quarantined thirdpartyrenderer/ folder and only runs when the site config
// opts in via  "plugins": ["mermaid"]  (see plugins.js).
//
// BRING YOUR OWN LIBRARY. Mermaid itself is never committed to this repo. The
// facade obtains it, in order:
//   1. window.mermaid, if you already loaded it in index.html;
//   2. a local file you drop next to this facade: thirdpartyrenderer/mermaid.min.js;
//   3. LIB_URL below, if you set it to a CDN/self-hosted URL.
// If none is available the renderer simply reports it and the block falls back
// to its source - the app keeps working. To adapt a different engine (e.g. a
// PlantUML server client), copy this file and change loadLib()/render().
// ===========================================================================

import { registerBlockRenderer } from '../js/blocks.js';
import { createPanZoom } from '../js/panzoom.js';

// Optional explicit URL for the library. Leave '' to prefer a local
// thirdpartyrenderer/mermaid.min.js (resolved relative to this module).
const LIB_URL = '';

// Height (px) of the pan/zoom frame each diagram is shown in. The reader can
// drag the frame's bottom edge to make it taller.
const VIEW_HEIGHT = 440;

let libPromise = null;

function loadLib() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (libPromise) return libPromise;
  const src = LIB_URL || new URL('./mermaid.min.js', import.meta.url).href;
  libPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => window.mermaid
      ? resolve(window.mermaid)
      : reject(new Error('loaded ' + src + ' but window.mermaid is undefined'));
    s.onerror = () => reject(new Error(
      'Mermaid library not found. Place mermaid.min.js in thirdpartyrenderer/ ' +
      'or set LIB_URL in thirdpartyrenderer/mermaid.js'));
    document.head.appendChild(s);
  });
  return libPromise;
}

let inited = false;
function initOnce(mermaid) {
  if (inited) return;
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  // securityLevel:'strict' is Mermaid's own XSS guard (no inline HTML labels, no
  // click handlers); the core also scrubs the produced SVG as defence-in-depth.
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });
  inited = true;
}

let seq = 0;

registerBlockRenderer('mermaid', async (source, ctx) => {
  const mermaid = await loadLib();           // rejects -> core shows the fallback notice
  initOnce(mermaid);
  const id = 'wd-mermaid-' + (seq++);
  const result = await mermaid.render(id, source); // v10+: Promise<{ svg }>
  const svg = (result && typeof result === 'object') ? result.svg : result;
  const wrap = document.createElement('div');
  wrap.className = 'mermaid-diagram';
  wrap.innerHTML = String(svg || ''); // scrubbed by the core renderBlocks stage after mount
  // Render the SVG at its natural size and let the pan/zoom viewport own display
  // sizing: it fits the diagram to the frame initially, then the reader zooms and
  // pans. Pinning the width to the natural (viewBox) width gives the viewport a
  // stable base to scale from, independent of Mermaid's inline max-width.
  const svgEl = wrap.querySelector('svg');
  if (svgEl) {
    const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
    const naturalW = (vb && vb.width) || parseFloat(svgEl.getAttribute('width')) || 0;
    svgEl.removeAttribute('height');
    svgEl.style.maxWidth = 'none';
    svgEl.style.height = 'auto';
    if (naturalW) svgEl.style.width = Math.round(naturalW) + 'px';
  }
  return createPanZoom(wrap, { height: VIEW_HEIGHT });
}, { label: 'Mermaid diagram' });
