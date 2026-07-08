import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    passWithNoTests: true,
    setupFiles: ['./vitest.setup.ts'],
    // Exclude Playwright E2E specs — they use a different runner
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    // Inline ESM-only packages so Vite transforms them rather than having
    // Node.js attempt to resolve them as native ES modules.
    server: {
      deps: {
        inline: [
          'react-markdown',
          'rehype-sanitize',
          'remark-parse',
          'remark-rehype',
          'unified',
          'vfile',
          /^hast-/,
          /^mdast-/,
          /^micromark/,
          /^unist-/,
          /^@tiptap/,
          'tiptap-markdown',
          'turndown',
        ],
      },
    },
  },
})
