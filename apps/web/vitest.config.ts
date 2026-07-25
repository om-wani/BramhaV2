import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  test: {
    environment: 'jsdom',
    passWithNoTests: true,
    // e2e/ is Playwright's — vitest must not collect it
    exclude: ['**/node_modules/**', '**/e2e/**', '**/.next/**'],
  },
});
