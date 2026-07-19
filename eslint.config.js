// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import boundaries from 'eslint-plugin-boundaries'
import security from 'eslint-plugin-security'

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Base JS recommended
  js.configs.recommended,

  // TypeScript
  ...tseslint.configs.recommended,

  // Security plugin
  {
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
    },
  },

  // Boundaries plugin — enforces dep direction from CLAUDE.md:
  // web → shared; server → shared, db, agents, event-bus; packages never import from apps
  {
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: './tsconfig.base.json' },
      },
      'boundaries/elements': [
        { type: 'app-web', pattern: ['apps/web/src/**', 'apps/web/dist/**'] },
        { type: 'app-server', pattern: ['apps/server/src/**', 'apps/server/dist/**'] },
        { type: 'pkg-shared', pattern: ['packages/shared/src/**', 'packages/shared/dist/**'] },
        { type: 'pkg-db', pattern: ['packages/db/src/**', 'packages/db/dist/**'] },
        { type: 'pkg-agents', pattern: ['packages/agents/src/**', 'packages/agents/dist/**'] },
        { type: 'pkg-event-bus', pattern: ['packages/event-bus/src/**', 'packages/event-bus/dist/**'] },
      ],
      'boundaries/ignore': ['**/*.test.ts', '**/*.test.tsx'],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: { type: 'app-web' }, allow: { to: { type: ['pkg-shared'] } } },
            {
              from: { type: 'app-server' },
              allow: { to: { type: ['pkg-shared', 'pkg-db', 'pkg-agents', 'pkg-event-bus'] } },
            },
            { from: { type: 'pkg-db' }, allow: { to: { type: ['pkg-shared'] } } },
            { from: { type: 'pkg-agents' }, allow: { to: { type: ['pkg-shared'] } } },
            { from: { type: 'pkg-event-bus' }, allow: { to: { type: ['pkg-shared'] } } },
            // pkg-shared has no deps
          ],
        },
      ],
    },
  },

  // Vendor SDK imports only allowed in packages/agents/src/providers/
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['packages/agents/src/providers/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@anthropic-ai/*'],
              message: 'Vendor SDK imports only allowed in packages/agents/src/providers/',
            },
            {
              group: ['openai', 'openai/*'],
              message: 'Vendor SDK imports only allowed in packages/agents/src/providers/',
            },
            {
              group: ['ai', 'ai/*'],
              message: 'Vendor SDK imports only allowed in packages/agents/src/providers/',
            },
          ],
        },
      ],
    },
  },

  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**', '.turbo/**', 'coverage/**', '**/*.d.ts'],
  },
]
