import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

// Component tests run the REAL compiler over the real components. The only thing
// faked is the server: there is no serve.py in a unit test, so the "/js/..."
// specifiers that vite.config.js keeps external at build time are resolved here
// to their files on disk. That is the same mapping the server performs, so the
// component under test imports exactly the module it will import in production.
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: [{ find: /^\/js\//, replacement: fileURLToPath(new URL('./app/js/', import.meta.url)) }],
    // Without this, Node's export conditions pick Svelte's SERVER build and
    // mount() throws lifecycle_function_unavailable. The components under test
    // are browser components; jsdom is a browser, so ask for the browser build.
    conditions: ['browser'],
  },
  test: {
    environment: 'jsdom',
    include: ['app/svelte/**/*.test.js'],
    globals: true,
  },
});
