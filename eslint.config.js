import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import tseslint from 'typescript-eslint';

// STILL A .js FILE, DELIBERATELY. ESLint only loads an `eslint.config.ts` when
// `jiti` is installed to transpile it, and jiti is not a dependency of this
// repo. A config file whose only gain from TypeScript is its extension is not
// worth a new dependency, so this one stays as it is.
//
// SCOPED TO app/svelte/ ONLY, and deliberately so.
//
// The hand-written browser modules (now src/js/, compiled to app/js/) are NOT
// linted. They have a strong, deliberate house style - comment-dense, explaining
// why rather than what - and a general-purpose linter pointed at them would
// spend its life arguing with decisions that were made on purpose. Their
// correctness is enforced by `tsc --noEmit` instead, which checks meaning rather
// than form.
//
// WHAT IS ENFORCED HERE is safety and architecture on the new code, not style:
//   - no-at-html-tags: {@html} bypasses Svelte's escaping. The app has a
//     hand-rolled sanitizer (src/js/sanitize.ts) and the ONE place raw HTML may
//     enter the document is through it. A component reaching for {@html} is how
//     that guarantee gets quietly lost.
//   - no-restricted-imports: a relative import climbing into app/js/ would be
//     BUNDLED rather than externalised, forking module state into a second
//     instance. vite.config.ts fails the build on this too; catching it in the
//     editor is faster than catching it in CI.
//
// TWO CORE RULES ARE TRADED FOR THEIR typescript-eslint TWINS below, now that
// every script in app/svelte/ is TypeScript. Both core rules read a type
// annotation as if it were code:
//   - no-undef reports every imported interface, and every `ev: MouseEvent`,
//     as an undefined global. tsc resolves names already, so the rule has
//     nothing left to add and only false positives to contribute.
//   - no-unused-vars reports the PARAMETER NAMES inside a function TYPE - the
//     `id` in `(id: string) => void` - as unused variables. They are
//     documentation, not bindings. Its typescript-eslint twin understands the
//     difference and still catches the genuinely dead ones.
// This is typescript-eslint's own recommendation, and it is the only part of
// that plugin adopted here: the parser plus these two rules, not its rule sets.
// Style is not this config's business, and meaning is checked by
// `svelte-check --tsconfig ./jsconfig.json`, exactly as it is for src/js/.
const typescriptCoreRuleSwap = {
  'no-undef': 'off',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': 'error',
};

// The relative-import tripwire, shared verbatim by the component block and the
// TypeScript block - the rule is about which specifier form reaches vite, and
// that is the same question in a `.svelte` script as in an island or a store.
const noRelativeAppJs = ['error', {
  patterns: [{
    group: ['../js/*', '../../js/*', './js/*'],
    message: 'Import app modules as absolute "/js/..." specifiers so vite.config.ts keeps them external. A bundled copy forks module state.',
  }],
}];

export default [
  js.configs.recommended,
  ...svelte.configs.recommended,
  {
    files: ['app/svelte/**/*.svelte'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // svelte-eslint-parser does not parse the <script> block itself: it hands
      // it to whatever `parserOptions.parser` names. That was null while the
      // scripts were plain JavaScript and espree could be assumed; now that
      // every script is lang="ts" it has to be typescript-eslint's parser, or
      // eslint fails on the first type annotation it meets.
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.svelte'] },
      globals: { window: 'readonly', document: 'readonly', console: 'readonly' },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      ...typescriptCoreRuleSwap,
      'svelte/no-at-html-tags': 'error',
      'no-restricted-imports': noRelativeAppJs,
    },
  },
  {
    files: ['app/svelte/**/*.svelte'],
    languageOptions: { parser: svelteParser },
  },
  {
    // Component tests run under vitest in jsdom: they get the test globals from
    // `globals: true` in vitest.config.ts, and the browser globals jsdom provides.
    files: ['app/svelte/**/*.test.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly', it: 'readonly', expect: 'readonly', vi: 'readonly',
        beforeEach: 'readonly', afterEach: 'readonly',
        MouseEvent: 'readonly', KeyboardEvent: 'readonly', Event: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
      },
    },
  },
  {
    // THE TYPESCRIPT UNDER app/svelte/ - the actions, islands, `.svelte.ts` rune
    // stores and component tests - is linted through typescript-eslint's parser.
    //
    // It has to be: espree rejects the first type annotation it meets, and
    // svelte-eslint-parser delegates `.svelte.ts` rune modules to the same
    // `parserOptions.parser` the components use. Before typescript-eslint was a
    // dependency, `npx eslint app/svelte` could not PARSE these files at all and
    // they were ignored outright; the parser is what buys back the editor-time
    // half of no-restricted-imports on them.
    //
    // Only the PARSER and the two rule swaps above are adopted, not
    // typescript-eslint's rule sets.
    files: ['app/svelte/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { window: 'readonly', document: 'readonly', console: 'readonly' },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      ...typescriptCoreRuleSwap,
      'no-restricted-imports': noRelativeAppJs,
    },
  },
  { ignores: ['app/build/**', 'app/js/**', 'app/dev/**', 'app/thirdpartyrenderer/**', 'node_modules/**'] },
];
