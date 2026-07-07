import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E test configuration.
 *
 * Tests assume the Next.js dev server is already running on port 3001
 * (started externally, e.g. `pnpm dev`).  Use `test:e2e` script.
 *
 * Run: pnpm --filter @bramha/web test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 4,

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
