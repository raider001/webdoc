// Runes-only. Svelte 5 still accepts the legacy `export let` / `$:` reactivity
// model, and accepting it here would let two mental models drift into the same
// codebase during a migration that runs for weeks. One model, chosen once.
export default {
  compilerOptions: { runes: true },
};
