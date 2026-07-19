import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 30000, // migrations can be slow on first run
    hookTimeout: 30000,
  },
});
