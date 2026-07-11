import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Long timeout: DB setup, fixture seeding, and HTTP probes can take a while in CI.
    testTimeout: 60000,
    hookTimeout: 60000,
    include: ['test/tenant-probes/**/*.test.ts'],
    // Run test files sequentially so that rls-probes.test.ts writes its section of
    // report.json before api-probes.test.ts reads and appends to it.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
})
