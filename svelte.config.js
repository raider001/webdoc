// STILL A .js FILE, DELIBERATELY, and this one is not a tooling gap but a
// support promise. @sveltejs/vite-plugin-svelte will happily look for a
// `svelte.config.ts` (see knownSvelteConfigNames), but it loads whichever it
// finds with a bare `import()` - so stripping the types is Node's job, not the
// bundler's. Node only does that from 22.18 / 24; package.json's `engines` still
// promises ^20.19 and ^22.12, where the same file is a syntax error at startup.
// This config declares one boolean. It is not worth narrowing the supported
// runtimes to spell that boolean in TypeScript.
//
// Runes-only. Svelte 5 still accepts the legacy `export let` / `$:` reactivity
// model, and accepting it here would let two mental models drift into the same
// codebase during a migration that runs for weeks. One model, chosen once.
export default {
  compilerOptions: { runes: true },
};
