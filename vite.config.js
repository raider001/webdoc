import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// THE LOAD-BEARING PLUGIN OF THE WHOLE STRATEGY.
//
// Any import of an existing app module is left as a bare ESM specifier so the
// BROWSER resolves it natively at run time, against the very same file main.js
// already loaded. That gives one module instance and one copy of its state.
// Bundling a copy instead would FORK that state - two `app` service registries,
// two `state` objects, two icon modules - and the resulting bugs would look like
// Svelte bugs rather than like a build-config mistake.
//
// The second branch is the tripwire: a relative import that climbs into app/js/
// would be bundled rather than externalised, silently forking exactly what the
// first branch protects. Fail the build loudly instead.
const keepNative = {
  name: 'webdoc-keep-native-esm',
  enforce: 'pre',
  resolveId(id) {
    if (id.startsWith('/js/')) return { id, external: true };
    if (/^\.\.?\//.test(id) && /\/app\/js\//.test(id)) {
      this.error(`Import "${id}" must be written as an absolute "/js/..." specifier so it stays external.`);
    }
    return null;
  },
};

export default defineConfig({
  plugins: [keepNative, svelte({ emitCss: false })],
  build: {
    outDir: 'app/build',
    emptyOutDir: true,
    target: 'es2022',
    // No sourcemap, deliberately. serve.py's route() serves everything under
    // APP_DIR before any ACL check, so a .map file there would be readable by a
    // signed-out visitor on an accounts-enabled server.
    sourcemap: false,
    minify: 'oxc',
    lib: { entry: 'app/svelte/entry.js', formats: ['es'], fileName: () => 'islands.js' },
    rollupOptions: {
      output: { codeSplitting: false },
      // app/thirdpartyrenderer is never a build input under this strategy; this
      // is belt-and-braces against someone making it one.
      external: [/app\/thirdpartyrenderer\//],
    },
  },
});
