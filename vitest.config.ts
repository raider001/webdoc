import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

// Component tests run the REAL compiler over the real components. The only thing
// faked is the server: there is no serve.py in a unit test, so the "/js/..."
// specifiers that vite.config.ts keeps external at build time are resolved here
// to their files on disk. That is the same mapping the server performs, so the
// component under test imports exactly the module it will import in production.
//
// The alias points at app/js/, the COMPILED output, not at src/js/. That is
// deliberate: it is what the browser loads and what the server serves, so a test
// that passed against src/ but failed against app/ would be testing a file
// nobody runs.
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
    include: ['app/svelte/**/*.test.ts'],
    globals: true,
  },
});
