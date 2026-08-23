import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';

// SCOPED TO app/svelte/ ONLY, and deliberately so.
//
// The 53 hand-written modules under app/js/ are NOT linted. They have a strong,
// deliberate house style - comment-dense, explaining why rather than what - and
// a general-purpose linter pointed at them would spend its life arguing with
// decisions that were made on purpose. Their correctness is enforced by
// `tsc --noEmit` over their JSDoc instead, which checks meaning rather than form.
//
// What IS enforced here is safety and architecture on the new code, not style:
//   - no-at-html-tags: {@html} bypasses Svelte's escaping. The app has a
//     hand-rolled sanitizer (app/js/sanitize.js) and the ONE place raw HTML may
//     enter the document is through it. A component reaching for {@html} is how
//     that guarantee gets quietly lost.
//   - no-restricted-imports: a relative import climbing into app/js/ would be
//     BUNDLED rather than externalised, forking module state into a second
//     instance. vite.config.js fails the build on this too; catching it in the
//     editor is faster than catching it in CI.
export default [
  js.configs.recommended,
  ...svelte.configs.recommended,
  {
    files: ['app/svelte/**/*.{js,svelte}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { parser: null, extraFileExtensions: ['.svelte'] },
      globals: { window: 'readonly', document: 'readonly', console: 'readonly' },
    },
    rules: {
      'svelte/no-at-html-tags': 'error',
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../js/*', '../../js/*', './js/*'],
          message: 'Import app modules as absolute "/js/..." specifiers so vite.config.js keeps them external. A bundled copy forks module state.',
        }],
      }],
    },
  },
  {
    files: ['app/svelte/**/*.svelte'],
    languageOptions: { parser: svelteParser },
  },
  {
    // Component tests run under vitest in jsdom: they get the test globals from
    // `globals: true` in vitest.config.js, and the browser globals jsdom provides.
    files: ['app/svelte/**/*.test.js'],
    languageOptions: {
      globals: {
        describe: 'readonly', it: 'readonly', expect: 'readonly', vi: 'readonly',
        beforeEach: 'readonly', afterEach: 'readonly',
        MouseEvent: 'readonly', KeyboardEvent: 'readonly', Event: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
      },
    },
  },
  { ignores: ['app/build/**', 'app/js/**', 'app/dev/**', 'app/thirdpartyrenderer/**', 'node_modules/**'] },
];
