/**
 * Sandbox host service — manages ephemeral code-execution containers.
 *
 * Per 01-doc §6.3:
 *   - No network namespace (--network none)
 *   - Read-only rootfs + tmpfs /workspace
 *   - Seccomp profile applied
 *   - 512 MB memory / 0.5 vCPU / 30 s hard caps
 *   - Output size capped at 64 KB
 *   - Container destroyed after run (never reused)
 *
 * Health: GET /health returns 200 when Docker daemon is reachable.
 * run_code tool disables itself (fail-closed) when health check fails.
 *
 * gVisor: set SANDBOX_RUNTIME=runsc for prod gVisor runtime class.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const SANDBOX_IMAGE = process.env['SANDBOX_IMAGE'] ?? 'bramha-sandbox-executor:latest'
const SANDBOX_RUNTIME = process.env['SANDBOX_RUNTIME'] ?? 'runc' // 'runsc' for gVisor
const MAX_OUTPUT_BYTES = 64 * 1024 // 64 KB
const TIMEOUT_SEC = 30
const MEMORY_LIMIT = '512m'
const CPU_LIMIT = '0.5'
const SECCOMP_PROFILE =
  process.env['SECCOMP_PROFILE_PATH'] ?? '/etc/bramha/seccomp-profile.json'

export interface RunCodeInput {
  language: 'python' | 'node'
  code: string
  stdin?: string
}

export interface RunCodeResult {
  stdout: string
  stderr: string
  exitCode: number
  truncated: boolean
}

export async function runCode(input: RunCodeInput): Promise<RunCodeResult> {
  const { language, code } = input

  const cmd = language === 'python' ? 'python3' : 'node'
  const flag = language === 'python' ? '-c' : '-e'

  const args = [
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/workspace:size=32m',
    '--memory',
    MEMORY_LIMIT,
    '--cpus',
    CPU_LIMIT,
    '--security-opt',
    `seccomp=${SECCOMP_PROFILE}`,
    '--runtime',
    SANDBOX_RUNTIME,
    '--user',
    'sandbox',
    '--stop-timeout',
    '5',
    SANDBOX_IMAGE,
    cmd,
    flag,
    code,
  ]

  try {
    const { stdout, stderr } = await Promise.race([
      execFileAsync('docker', args, { maxBuffer: MAX_OUTPUT_BYTES * 2 }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('sandbox_timeout')),
          (TIMEOUT_SEC + 2) * 1000,
        ),
      ),
    ])

    const truncated = stdout.length > MAX_OUTPUT_BYTES
    return {
      stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
      stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
      exitCode: 0,
      truncated,
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'sandbox_timeout') {
      return {
        stdout: '',
        stderr: 'Execution timed out',
        exitCode: 124,
        truncated: false,
      }
    }
    const errMsg = err instanceof Error ? err.message : String(err)
    return {
      stdout: '',
      stderr: errMsg.slice(0, MAX_OUTPUT_BYTES),
      exitCode: 1,
      truncated: false,
    }
  }
}

// ── Health check server ───────────────────────────────────────────────────────

async function isDockerHealthy(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      timeout: 5000,
    })
    return true
  } catch {
    return false
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    const healthy = await isDockerHealthy()
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded' }))
    return
  }

  if (req.method === 'POST' && req.url === '/run') {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', async () => {
      try {
        const input = JSON.parse(body) as RunCodeInput
        if (!['python', 'node'].includes(input.language)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'unsupported_language' }))
          return
        }
        const result = await runCode(input)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })
    return
  }

  res.writeHead(404)
  res.end()
})

const PORT = parseInt(process.env['SANDBOX_PORT'] ?? '4200', 10)

// Only start the HTTP server when this file is the entry point, not when imported by tests.
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  server.listen(PORT, () => {
    console.log(JSON.stringify({ event: 'sandbox-host.started', port: PORT }))
  })
}
