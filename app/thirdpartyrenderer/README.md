# thirdpartyrenderer/

Facades that adapt **external** rendering libraries to the core block-renderer
contract. This folder is the *only* place third-party-facing code lives — the
rest of `app/js/` is pure, hand-written, zero-dependency core.

## How it works

1. The core registry and pipeline stage live in [`../js/blocks.js`](../js/blocks.js).
   It knows nothing about any specific library.
2. A facade here imports `registerBlockRenderer` from the core and wires a
   fenced language (e.g. ` ```mermaid `) to an external renderer.
3. A facade is only loaded when the site opts in via `config.json`:

   ```json
   { "plugins": ["mermaid"] }
   ```

   The loader ([`../js/plugins.js`](../js/plugins.js)) imports
   `thirdpartyrenderer/<name>.js` for each listed plugin, tolerating any that
   are missing or broken.

## Bring your own library

The third-party libraries themselves are **not committed to this repo** — that
would break the zero-dependency guarantee for anyone who ships the tool as-is.
Each facade fetches its library at runtime (from `window`, a local file you drop
in this folder, or a URL you configure). If the library is absent, the block
falls back to showing its source and the app keeps working.

Suggested (git-ignored) local drop-in for the reference facade:

```
thirdpartyrenderer/mermaid.min.js
```

## Adding a renderer

Copy `mermaid.js`, change the fenced language, the library it loads, and the
`render(source, ctx)` body. A renderer may return a `Node`, a
`Promise<Node>` (for libraries that load or parse asynchronously), or fill
`ctx.host` directly. Anything it produces is scrubbed by the core for scripts,
inline event handlers and script-y URLs before it stays in the live DOM.

To render **PlantUML**, which has no production in-browser engine, a facade
instead encodes the source and points an `<img>`/`fetch` at a PlantUML or Kroki
server URL — same contract, different `render()` body.
