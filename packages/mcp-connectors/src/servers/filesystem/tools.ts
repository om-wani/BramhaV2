/**
 * Filesystem MCP server — tool implementations.
 *
 * Security invariants:
 * - Null bytes in path → path_traversal_denied
 * - Path segments containing '..' → path_traversal_denied
 * - Resolved path outside project root → path_traversal_denied
 * - Symlink resolves outside project root → path_traversal_denied
 * - Raw OS errors are never returned to callers
 */

import { resolve, sep } from 'node:path'
import { readFile, writeFile, readdir, realpath, stat } from 'node:fs/promises'

// ── Path traversal error ──────────────────────────────────────────────────────

export class PathTraversalError extends Error {
  constructor() {
    super('path_traversal_denied')
    this.name = 'PathTraversalError'
  }
}

// ── Path validation ───────────────────────────────────────────────────────────

/**
 * Resolve and validate a user-supplied path against the project chroot.
 * Throws PathTraversalError on any violation.
 *
 * Checks in order:
 * 1. Null bytes
 * 2. Path segments containing '..'
 * 3. Lexical resolved path must be within projectRoot
 * 4. If path exists: realpath (symlink resolution) must also be within projectRoot
 *
 * Returns the lexically-resolved absolute path.
 */
export async function resolveSafePath(projectRoot: string, userPath: string): Promise<string> {
  // 1. Reject null bytes
  if (userPath.includes('\0')) throw new PathTraversalError()

  // 2. Reject path segments containing '..'
  //    Split on both / and \ to handle all separators
  const segments = userPath.split(/[/\\]/)
  for (const seg of segments) {
    if (seg === '..') throw new PathTraversalError()
  }

  // 3. Lexical resolution — path.resolve handles absolute paths too
  //    e.g. resolve('/data/proj', '/data/other') → '/data/other' (absolute override)
  const resolved = resolve(projectRoot, userPath)

  // Must start with projectRoot + sep, or equal projectRoot exactly
  if (resolved !== projectRoot && !resolved.startsWith(projectRoot + sep)) {
    throw new PathTraversalError()
  }

  // 4. Symlink check — only if path exists
  try {
    const real = await realpath(resolved)
    if (real !== projectRoot && !real.startsWith(projectRoot + sep)) {
      throw new PathTraversalError()
    }
  } catch (err) {
    // PathTraversalError is a real error — re-throw it
    if (err instanceof PathTraversalError) throw err
    // ENOENT etc. → path doesn't exist yet (valid for write_file), skip symlink check
  }

  return resolved
}

// ── Tool implementations ──────────────────────────────────────────────────────

export interface FsResult {
  content?: string
  entries?: string[]
  error?: string
}

/** Read a file within the project chroot. */
export async function fsReadFile(projectRoot: string, userPath: string): Promise<FsResult> {
  let safePath: string
  try {
    safePath = await resolveSafePath(projectRoot, userPath)
  } catch (err) {
    if (err instanceof PathTraversalError) return { error: 'path_traversal_denied' }
    return { error: 'path_traversal_denied' }
  }

  try {
    // Stat to reject directories
    const st = await stat(safePath)
    if (st.isDirectory()) return { error: 'is_a_directory' }

    const content = await readFile(safePath, 'utf-8')
    return { content }
  } catch {
    // Never leak OS error messages
    return { error: 'read_failed' }
  }
}

/** List directory entries within the project chroot. */
export async function fsListDir(projectRoot: string, userPath: string): Promise<FsResult> {
  let safePath: string
  try {
    safePath = await resolveSafePath(projectRoot, userPath)
  } catch (err) {
    if (err instanceof PathTraversalError) return { error: 'path_traversal_denied' }
    return { error: 'path_traversal_denied' }
  }

  try {
    const entries = await readdir(safePath)
    return { entries }
  } catch {
    return { error: 'list_failed' }
  }
}

/** Write a file within the project chroot. */
export async function fsWriteFile(
  projectRoot: string,
  userPath: string,
  content: string,
): Promise<FsResult> {
  let safePath: string
  try {
    safePath = await resolveSafePath(projectRoot, userPath)
  } catch (err) {
    if (err instanceof PathTraversalError) return { error: 'path_traversal_denied' }
    return { error: 'path_traversal_denied' }
  }

  try {
    await writeFile(safePath, content, 'utf-8')
    return { content: 'ok' }
  } catch {
    return { error: 'write_failed' }
  }
}
