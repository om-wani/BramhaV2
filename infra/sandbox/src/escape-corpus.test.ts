/**
 * Sandbox escape corpus — integration tests against a real Docker sandbox.
 *
 * These tests are skipped by default. Set SANDBOX_INTEGRATION=true to run them.
 * Requires: Docker daemon running, bramha-sandbox-executor image built.
 *
 *   SANDBOX_INTEGRATION=true pnpm --filter @bramha/sandbox-host test
 */

import { describe, it, expect } from 'vitest'
import { runCode } from './sandbox-host.js'

const RUN = process.env['SANDBOX_INTEGRATION'] === 'true'

describe.skipIf(!RUN)('sandbox escape corpus', () => {
  it('blocks network access attempt', async () => {
    const result = await runCode({
      language: 'python',
      code: `import socket; socket.create_connection(("8.8.8.8", 53), timeout=2)`,
    })
    expect(result.exitCode).not.toBe(0)
  }, 35_000)

  it('kills fork bomb within caps', async () => {
    const result = await runCode({
      language: 'python',
      code: `import os\nwhile True: os.fork()`,
    })
    expect(result.exitCode).not.toBe(0)
  }, 35_000)

  it('caps memory at 512 MB', async () => {
    const result = await runCode({
      language: 'python',
      code: `x = bytearray(1024 * 1024 * 1024)  # 1 GB alloc`,
    })
    expect(result.exitCode).not.toBe(0)
  }, 35_000)

  it('kills 60s spin within 30s timeout', async () => {
    const start = Date.now()
    const result = await runCode({
      language: 'python',
      code: `import time; time.sleep(60)`,
    })
    expect(Date.now() - start).toBeLessThan(35_000)
    expect(result.exitCode).toBe(124)
  }, 40_000)

  it('blocks /proc filesystem read', async () => {
    const result = await runCode({
      language: 'python',
      code: `open('/proc/1/environ').read()`,
    })
    // Should fail — /proc not accessible in read-only + no-network sandbox
    expect(result.exitCode).not.toBe(0)
  }, 35_000)

  it('runs python hello world successfully', async () => {
    const result = await runCode({
      language: 'python',
      code: `print('hello from sandbox')`,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello from sandbox')
  }, 35_000)

  it('runs node hello world successfully', async () => {
    const result = await runCode({
      language: 'node',
      code: `console.log('hello from node sandbox')`,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello from node sandbox')
  }, 35_000)
})
