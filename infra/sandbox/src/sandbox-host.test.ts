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

  it('fires timeout at exactly 30 s and calls docker stop', async () => {
    vi.useFakeTimers()
    try {
      const { execFile } = await import('node:child_process')

      let rejectDockerRun!: (err: Error) => void
      const runPromise = new Promise<never>((_, reject) => {
        rejectDockerRun = reject
      })

      // First call = docker run (hangs until we reject it)
      // Subsequent calls = docker stop (resolves immediately)
      vi.mocked(execFile)
        .mockImplementationOnce(() => runPromise as never)
        .mockResolvedValue({ stdout: '', stderr: '' } as never)

      const resultPromise = runCode({
        language: 'python',
        code: 'import time; time.sleep(999)',
      })

      // 29 999 ms — timeout must NOT have fired yet
      await vi.advanceTimersByTimeAsync(29_999)
      const stopCallsBefore = vi.mocked(execFile).mock.calls.filter(
        (c) => Array.isArray(c[1]) && (c[1] as string[]).includes('stop'),
      )
      expect(stopCallsBefore).toHaveLength(0)

      // At exactly 30 000 ms — timeout fires, docker stop must be called
      await vi.advanceTimersByTimeAsync(1)

      const allCalls = vi.mocked(execFile).mock.calls
      const stopCall = allCalls.find(
        (c) => Array.isArray(c[1]) && (c[1] as string[])[0] === 'stop',
      )
      expect(stopCall).toBeDefined()
      const stopArgs = stopCall![1] as string[]
      expect(stopArgs[0]).toBe('stop')
      expect(stopArgs).toContain('--time')
      expect(stopArgs).toContain('2')

      // containerName used in --name must match the stop target
      const runCall = allCalls.find(
        (c) => Array.isArray(c[1]) && (c[1] as string[])[0] === 'run',
      )
      const runArgs = runCall![1] as string[]
      const nameIdx = runArgs.indexOf('--name')
      const containerName = runArgs[nameIdx + 1]
      expect(containerName).toMatch(/^bramha-sandbox-/)
      expect(stopArgs).toContain(containerName)

      // Simulate container exiting after stop
      rejectDockerRun(new Error('signal: killed'))
      const result = await resultPromise
      expect(result.exitCode).toBe(124)
      expect(result.stderr).toContain('timed out')
    } finally {
      vi.useRealTimers()
    }
  })

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
