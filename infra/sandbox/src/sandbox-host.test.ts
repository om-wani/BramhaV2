import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock execFile so tests don't spawn real Docker
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))
vi.mock('node:util', () => ({
  promisify: (fn: unknown) => fn,
}))

import { runCode } from './sandbox-host.js'

describe('runCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs python code and returns stdout', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockResolvedValue({
      stdout: 'hello\n',
      stderr: '',
    } as never)
    const result = await runCode({ language: 'python', code: 'print("hello")' })
    expect(result.stdout).toBe('hello\n')
    expect(result.exitCode).toBe(0)
  })

  it('passes --network none and --read-only flags', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockResolvedValue({ stdout: '', stderr: '' } as never)
    await runCode({ language: 'node', code: 'console.log(1)' })
    const args = vi.mocked(execFile).mock.calls[0]?.[1] as string[]
    expect(args).toContain('--network')
    expect(args).toContain('none')
    expect(args).toContain('--read-only')
  })

  it('truncates output exceeding 64 KB', async () => {
    const { execFile } = await import('node:child_process')
    const bigOutput = 'x'.repeat(100_000)
    vi.mocked(execFile).mockResolvedValue({ stdout: bigOutput, stderr: '' } as never)
    const result = await runCode({ language: 'python', code: '' })
    expect(result.stdout.length).toBe(64 * 1024)
    expect(result.truncated).toBe(true)
  })

  it('returns timeout error when execution exceeds 30s', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation(
      () => new Promise<never>(() => {}) as never,
    ) // never resolves
    const result = await runCode({
      language: 'python',
      code: 'import time; time.sleep(999)',
    })
    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain('timed out')
  }, 35_000)

  it('passes --memory and --cpus caps', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockResolvedValue({ stdout: '', stderr: '' } as never)
    await runCode({ language: 'python', code: 'pass' })
    const args = vi.mocked(execFile).mock.calls[0]?.[1] as string[]
    expect(args).toContain('--memory')
    expect(args).toContain('512m')
    expect(args).toContain('--cpus')
    expect(args).toContain('0.5')
  })

  it('passes --security-opt seccomp flag', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockResolvedValue({ stdout: '', stderr: '' } as never)
    await runCode({ language: 'python', code: 'pass' })
    const args = vi.mocked(execFile).mock.calls[0]?.[1] as string[]
    const seccompIdx = args.indexOf('--security-opt')
    expect(seccompIdx).toBeGreaterThan(-1)
    expect(args[seccompIdx + 1]).toMatch(/seccomp=/)
  })

  it('returns stderr on container exit with error', async () => {
    const { execFile } = await import('node:child_process')
    const error = new Error('Command failed: docker run\nPermission denied') as Error & {
      stdout: string
      stderr: string
    }
    error.stdout = ''
    error.stderr = 'Permission denied'
    vi.mocked(execFile).mockRejectedValue(error)
    const result = await runCode({ language: 'python', code: 'pass' })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Permission denied')
  })
})
