// Flat ESLint config. The "architecture rules" block is the point of this file:
// module boundaries, no `any`, no hardcoded products (ADR-013), and the scoped
// `dangerouslySetInnerHTML` ban from docs/architecture/15-security-architecture.md §6.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import nextPlugin from '@next/eslint-plugin-next'
import globals from 'globals'
import cpRules from './eslint-rules/no-hardcoded-products.js'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---------------------------------------------------------------- base rules
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { cp: cpRules },
    rules: {
      // Master prompt §32: no unnecessary `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // ADR-013 — products are registry data.
      'cp/no-hardcoded-products': 'error',

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',

      // docs/architecture/02 §6 — the z-index scale is fixed; see also the
      // token rule below. Arbitrary magic numbers in styles are caught in review.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            'dangerouslySetInnerHTML is banned (15-security-architecture.md §6). The only ' +
            'exception is the pre-paint theme bootstrap in the root layout, which carries a ' +
            'file-scoped eslint-disable referencing that section.',
        },
      ],
    },
  },

  // -------------------------------------------------- MODULE BOUNDARIES (HLD §4.1)
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // A package's public interface is its index. Reaching past it
              // defeats the extraction path in ADR-001.
              group: ['@cp/*/src/*', '@cp/*/dist/*'],
              message:
                'Deep import. Import a package only through its public entry point (HLD §4.1).',
            },
            {
              group: ['**/../../apps/**', '**/../../packages/**'],
              message:
                'Relative import across a package boundary. Use the @cp/* alias (HLD §4.1).',
            },
          ],
        },
      ],
    },
  },

  // The API must not depend on the web app or on UI components.
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@cp/ui', '@cp/ui/*'], message: 'The API must not import UI components.' },
            { group: ['@cp/web', '@cp/web/*'], message: 'The API must not import the web app.' },
            { group: ['react', 'react-dom', 'next', 'next/*'], message: 'No frontend deps in the API.' },
            { group: ['@cp/*/src/*'], message: 'Deep import (HLD §4.1).' },
          ],
        },
      ],
    },
  },

  // The web app must not import the API's internals; it talks over HTTP.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@cp/api', '@cp/api/*', '**/apps/api/**'],
              message:
                'The web app must not import the API. Use the BFF route handlers over HTTP ' +
                '(ADR-032, docs/design/11-frontend-architecture.md §4).',
            },
            { group: ['@cp/*/src/*'], message: 'Deep import (HLD §4.1).' },
          ],
        },
      ],
    },
  },

  // The domain layer is pure: no framework, no I/O (HLD §3).
  {
    files: ['packages/modules/*/domain/**/*.ts', 'packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['kysely', 'fastify', 'pg', 'next', 'react', '@cp/db', '@cp/ui'],
              message:
                'The domain layer must not import infrastructure or frameworks (HLD §3). ' +
                'Declare a port and let infrastructure implement it.',
            },
          ],
        },
      ],
    },
  },

  // ----------------------------------------------------------------- frontend
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      '@next/next': nextPlugin,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      // docs/design/10-accessibility.md §11 — semantic HTML, not div+onClick.
      'jsx-a11y/no-static-element-interactions': 'error',
      'jsx-a11y/click-events-have-key-events': 'error',
    },
  },

  // Public route groups must stay server-rendered (ADR-019, design 11 §2.1):
  // a 'use client' at a public layout/page root silently defeats SSR and the SEO
  // justification for choosing Next.js at all.
  {
    files: ['apps/web/app/(public)/**/{layout,page}.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ExpressionStatement > Literal[value='use client']",
          message:
            "'use client' at a (public) layout or page root defeats server rendering, which is " +
            'the reason ADR-019 chose Next.js. Push the client boundary down to a leaf.',
        },
      ],
    },
  },

  // The rule's own definition must name the reserved slugs, and the ADR-013
  // verification test must name them to assert they are ABSENT. Both are the
  // opposite of a violation. Exempted by exact path — never broadly, or the rule
  // would stop protecting the code that matters.
  {
    files: ['eslint-rules/no-hardcoded-products.js', 'apps/web/e2e/foundation.spec.ts'],
    rules: { 'cp/no-hardcoded-products': 'off' },
  },

  // Fixtures deliberately violate rules so tests can prove the rules fire. They
  // are excluded from the build and linted only by the rule-verification test.
  {
    files: ['**/__lint-fixtures__/**'],
    rules: {
      'cp/no-hardcoded-products': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // Tests may use `any` where mocking genuinely requires it.
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // Config and script files run in Node and may log.
  {
    files: ['*.config.{js,ts,mjs}', 'scripts/**/*.mjs', 'eslint-rules/**/*.js'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
