/**
 * Git MCP server — tool implementations.
 *
 * Security invariants:
 * - Only https:// and git+https:// schemes allowed (no ssh://, git://, file://)
 * - File paths within the clone must not escape the clone root
 * - No git push support
 * - Clone size capped at 500 MB
 * - Raw OS/git errors never returned to caller
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { rm } from 'node:fs/promises'

const execFileAsync = promisify(execFile)

// ── Constants ─────────────────────────────────────────────────────────────────

/** Max clone size in bytes (500 MB). */
export const MAX_CLONE_BYTES = 500 * 1024 * 1024

/** Allowed URL schemes (case-insensitive). */
const ALLOWED_SCHEMES = ['https:', 'git+https:']

// ── Error types ───────────────────────────────────────────────────────────────

export class SchemeNotAllowedError extends Error {
  constructor() {
    super('scheme_not_allowed')
    this.name = 'SchemeNotAllowedError'
  }
}

export class PathTraversalError extends Error {
  constructor() {
    super('path_traversal_denied')
    this.name = 'PathTraversalError'
  }
}

export class CloneSizeError extends Error {
  constructor() {
    super('clone_too_large')
    this.name = 'CloneSizeError'
  }
}

// ── URL validation ────────────────────────────────────────────────────────────

/**
 * Validate that a repo URL uses an allowed scheme.
 * Throws SchemeNotAllowedError for ssh://, git://, file://, and any others.
 */
export function validateRepoUrl(repoUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(repoUrl)
  } catch {
    throw new SchemeNotAllowedError()
  }

  const scheme = parsed.protocol.toLowerCase()
  if (!ALLOWED_SCHEMES.includes(scheme)) {
    throw new SchemeNotAllowedError()
  }
}

// ── Clone root derivation ─────────────────────────────────────────────────────

/**
 * Derive the clone directory for a given project + repo URL.
 * Uses a SHA-256 hash of the URL to create a stable, safe directory name.
 */
export function cloneDir(gitRoot: string, projectId: string, repoUrl: string): string {
  const urlHash = createHash('sha256').update(repoUrl).digest('hex').slice(0, 16)
  return resolve(gitRoot, projectId, urlHash)
}

// ── Path validation within clone ──────────────────────────────────────────────

/**
 * Validate a file path within a clone root (same traversal checks as fs server).
 * Returns the resolved absolute path.
 * Throws PathTraversalError on any violation.
 */
export async function resolveSafeClonePath(cloneRoot: string, filePath: string): Promise<string> {
  if (filePath.includes('\0')) throw new PathTraversalError()

  const segments = filePath.split(/[/\\]/)
  for (const seg of segments) {
    if (seg === '..') throw new PathTraversalError()
  }

  const resolved = resolve(cloneRoot, filePath)
  if (resolved !== cloneRoot && !resolved.startsWith(cloneRoot + sep)) {
    throw new PathTraversalError()
  }

  // Symlink check if path exists
  try {
    const real = await realpath(resolved)
    if (real !== cloneRoot && !real.startsWith(cloneRoot + sep)) {
      throw new PathTraversalError()
    }
  } catch (err) {
    if (err instanceof PathTraversalError) throw err
    // ENOENT — file doesn't exist, skip symlink check
  }

  return resolved
}

// ── Git exec abstraction (injectable for testing) ─────────────────────────────

export type GitExecFn = (args: string[], cwd?: string) => Promise<{ stdout: string; stderr: string }>

export const defaultGitExec: GitExecFn = async (args, cwd) => {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    timeout: 120_000, // 2 minutes max for clone
    maxBuffer: 10 * 1024 * 1024, // 10 MB stdout buffer
    env: {
      // Minimal safe env for git — no SSH agent, no credential helpers
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
      HOME: '/tmp',
      GIT_TERMINAL_PROMPT: '0', // Never prompt for credentials
      GIT_ASKPASS: 'echo',       // Return empty string for any credential prompt
    },
  })
  return { stdout, stderr }
}

// ── Tool: clone ───────────────────────────────────────────────────────────────

export interface CloneResult {
  path?: string
  error?: string
}

export async function gitClone(
  gitRoot: string,
  projectId: string,
  repoUrl: string,
  ref?: string,
  gitExec: GitExecFn = defaultGitExec,
): Promise<CloneResult> {
  try {
    validateRepoUrl(repoUrl)
  } catch (err) {
    if (err instanceof SchemeNotAllowedError) return { error: 'scheme_not_allowed' }
    return { error: 'invalid_url' }
  }

  const dir = cloneDir(gitRoot, projectId, repoUrl)
  const cloneArgs = ['clone', '--depth=1']

  if (ref) {
    cloneArgs.push('--branch', ref)
  }

  cloneArgs.push('--', repoUrl, dir)

  try {
    await gitExec(cloneArgs)
  } catch {
    // Never leak git error output (may contain credentials from URL)
    return { error: 'clone_failed' }
  }

  // Check clone size
  try {
    const { stdout } = await gitExec(['count-objects', '-v'], dir)
    const sizeKbMatch = /size-pack:\s+(\d+)/u.exec(stdout)
    if (sizeKbMatch?.[1]) {
      const sizeBytes = parseInt(sizeKbMatch[1], 10) * 1024
      if (sizeBytes > MAX_CLONE_BYTES) {
        // Delete oversized clone
        await rm(dir, { recursive: true, force: true })
        return { error: 'clone_too_large' }
      }
    }
  } catch {
    // Size check failure is non-fatal — proceed
  }

  return { path: dir }
}

// ── Tool: read_file ───────────────────────────────────────────────────────────

export interface GitReadResult {
  content?: string
  error?: string
}

export async function gitReadFile(
  gitRoot: string,
  projectId: string,
  repoUrl: string,
  filePath: string,
  ref?: string,
  gitExec: GitExecFn = defaultGitExec,
): Promise<GitReadResult> {
  try {
    validateRepoUrl(repoUrl)
  } catch {
    return { error: 'scheme_not_allowed' }
  }

  const dir = cloneDir(gitRoot, projectId, repoUrl)

  // Check if already cloned, clone if not
  try {
    await stat(dir)
  } catch {
    // Not cloned yet — clone it
    const cloneResult = await gitClone(gitRoot, projectId, repoUrl, ref, gitExec)
    if (cloneResult.error) return { error: cloneResult.error }
  }

  // Validate file path
  let safePath: string
  try {
    safePath = await resolveSafeClonePath(dir, filePath)
  } catch (err) {
    if (err instanceof PathTraversalError) return { error: 'path_traversal_denied' }
    return { error: 'path_traversal_denied' }
  }

  try {
    const content = await readFile(safePath, 'utf-8')
    return { content }
  } catch {
    return { error: 'read_failed' }
  }
}
