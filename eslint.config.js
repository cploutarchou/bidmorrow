// Flat ESLint config for the whole workspace.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Forbidden patterns per docs/security.md
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // False-positive guard: Cloudflare's documented `Cloudflare.Env`
      // declaration-merging pattern requires `interface Env extends X {}`.
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],
      // SEC-P7-02: never render source-derived procurement/user content as
      // HTML (docs/security.md C2) — ban the JSX attribute outright rather
      // than relying on reviewer vigilance.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message:
            'dangerouslySetInnerHTML is banned for source-derived data per docs/security.md C2.',
        },
      ],
    },
  },
  {
    // React app may use console-free browser code too; JSX handled by TS.
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {},
  },
  prettier,
);
