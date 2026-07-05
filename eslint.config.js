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

  // Boundaries plugin
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'app-web', pattern: 'apps/web/src/**' },
        { type: 'app-api', pattern: 'apps/api/src/**' },
        { type: 'app-agent-runtime', pattern: 'apps/agent-runtime/src/**' },
        { type: 'app-ingestion-worker', pattern: 'apps/ingestion-worker/src/**' },
        { type: 'pkg-shared', pattern: 'packages/shared/src/**' },
        { type: 'pkg-db', pattern: 'packages/db/src/**' },
        { type: 'pkg-agents', pattern: 'packages/agents/src/**' },
        { type: 'pkg-agents-providers', pattern: 'packages/agents/src/providers/**' },
        { type: 'pkg-event-bus', pattern: 'packages/event-bus/src/**' },
        { type: 'pkg-mcp-connectors', pattern: 'packages/mcp-connectors/src/**' },
      ],
      'boundaries/ignore': ['**/*.test.ts', '**/*.test.tsx'],
    },
    rules: {
      // Using boundaries/dependencies (v6 successor to deprecated element-types)
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: { type: 'app-web' }, allow: { to: { type: ['pkg-shared'] } } },
            {
              from: { type: 'app-api' },
              allow: { to: { type: ['pkg-shared', 'pkg-db', 'pkg-event-bus'] } },
            },
            {
              from: { type: 'app-agent-runtime' },
              allow: {
                to: {
                  type: ['pkg-shared', 'pkg-db', 'pkg-event-bus', 'pkg-agents', 'pkg-mcp-connectors'],
                },
              },
            },
            {
              from: { type: 'app-ingestion-worker' },
              allow: { to: { type: ['pkg-shared', 'pkg-db', 'pkg-event-bus', 'pkg-agents'] } },
            },
            // packages can only import from shared
            { from: { type: 'pkg-db' }, allow: { to: { type: ['pkg-shared'] } } },
            { from: { type: 'pkg-agents' }, allow: { to: { type: ['pkg-shared'] } } },
            { from: { type: 'pkg-agents-providers' }, allow: { to: { type: ['pkg-shared'] } } },
            { from: { type: 'pkg-event-bus' }, allow: { to: { type: ['pkg-shared'] } } },
            { from: { type: 'pkg-mcp-connectors' }, allow: { to: { type: ['pkg-shared'] } } },
            // pkg-shared has no deps
          ],
        },
      ],
    },
  },

  // Vendor SDK import restriction: only allowed in packages/agents/src/providers/**
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
              group: ['@google/*', 'google-generativeai'],
              message: 'Vendor SDK imports only allowed in packages/agents/src/providers/',
            },
            {
              group: ['ollama', 'ollama/*'],
              message: 'Vendor SDK imports only allowed in packages/agents/src/providers/',
            },
            {
              group: ['ai', 'ai/*'],
              message:
                'Vendor SDK imports (ai package) only allowed in packages/agents/src/providers/',
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
