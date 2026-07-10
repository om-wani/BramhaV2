/**
 * GitHub / GitLab sync strategy.
 *
 * Clones a repo (via git clone), walks files, chunks & embeds content.
 *
 * Security:
 *   - Only https:// URLs allowed (no git://, ssh://, file://)
 *   - Size cap: 500 MB total clone (abort if exceeded)
 *   - Max individual file size: 1 MB (skip larger)
 *   - Credential injected via https URL (not logged)
 *   - Temp directory cleaned up even on error
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { readdir } from 'node:fs/promises'
import type { EmbeddingProvider } from '@bramha/agents'
import type postgres from 'postgres'
import type { Chunk } from '../chunking.js'
import { chunkSections } from '../chunking.js'
import { embedChunks } from '../embedder.js'
import { upsertKnowledgeChunks } from '../knowledge-writer.js'

const execFileAsync = promisify(execFile)

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_REPO_BYTES = 500 * 1024 * 1024 // 500 MB
const MAX_FILE_BYTES = 1024 * 1024 // 1 MB

const ALLOWED_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.ts', '.js', '.tsx', '.jsx',
  '.py', '.go', '.rs', '.java', '.cs', '.rb', '.php',
  '.html', '.css', '.json', '.yaml', '.yml', '.toml', '.sql',
])

// ── Interface ─────────────────────────────────────────────────────────────────

export interface GitSyncConfig {
  repoUrl: string
  branch?: string
}

export interface GitSyncDeps {
  sql: postgres.Sql
  embeddingProvider: EmbeddingProvider
}

export interface GitSyncResult {
  fileCount: number
  chunkCount: number
  tokenTotal: number
  skippedCount: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function injectCredential(repoUrl: string, credential: string): string {
  // Only accept https:// URLs
  if (!repoUrl.startsWith('https://')) {
    throw new Error(`only_https_urls_allowed: ${repoUrl.substring(0, 30)}`)
  }
  const url = new URL(repoUrl)
  url.username = 'oauth2'
  url.password = credential
  return url.toString()
}

/** Walk directory recursively, yielding file paths. */
async function* walkDir(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue // skip .git etc
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkDir(full)
    } else if (entry.isFile()) {
      yield full
    }
  }
}

/** Compute total size of directory tree (used for size cap check). */
async function getDirSize(dir: string): Promise<number> {
  let total = 0
  for await (const filePath of walkDir(dir)) {
    try {
      const s = await stat(filePath)
      total += s.size
    } catch {
      // ignore
    }
  }
  return total
}

// ── Main sync function ────────────────────────────────────────────────────────

export async function syncGitRepo(
  projectId: string,
  sourceId: string,
  config: GitSyncConfig,
  credential: string | null,
  deps: GitSyncDeps,
): Promise<GitSyncResult> {
  const { repoUrl, branch = 'main' } = config

  if (!repoUrl || !repoUrl.startsWith('https://')) {
    throw new Error('only_https_urls_allowed')
  }

  // Build clone URL (with credential if provided — NEVER log this)
  const cloneUrl = credential ? injectCredential(repoUrl, credential) : repoUrl

  const tmpDir = await mkdtemp(join(tmpdir(), 'bramha-git-'))

  try {
    // Clone with depth=1 for efficiency
    await execFileAsync('git', [
      'clone',
      '--depth', '1',
      '--branch', branch,
      '--single-branch',
      cloneUrl,
      tmpDir,
    ], {
      timeout: 120_000, // 2 minutes
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0', // never prompt for credentials
        GIT_ASKPASS: 'echo',
      },
    })

    // Check size cap
    const totalSize = await getDirSize(tmpDir)
    if (totalSize > MAX_REPO_BYTES) {
      throw new Error(`repo_size_exceeded: ${totalSize} > ${MAX_REPO_BYTES}`)
    }

    // Walk files and accumulate chunks
    const allChunks: Chunk[] = []
    let fileCount = 0
    let skippedCount = 0

    for await (const filePath of walkDir(tmpDir)) {
      const ext = extname(filePath).toLowerCase()
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        skippedCount++
        continue
      }

      const s = await stat(filePath)
      if (s.size > MAX_FILE_BYTES) {
        skippedCount++
        continue
      }

      let content: string
      try {
        content = await readFile(filePath, 'utf8')
      } catch {
        skippedCount++
        continue
      }

      if (!content.trim()) continue

      // Relative path from repo root as heading
      const relPath = filePath.slice(tmpDir.length + 1)

      const sections = [{ headingTrail: [relPath], text: content }]
      const chunks = chunkSections(sections)
      allChunks.push(...chunks)
      fileCount++
    }

    if (allChunks.length === 0) {
      return { fileCount, chunkCount: 0, tokenTotal: 0, skippedCount }
    }

    // Embed and write
    const embedded = await embedChunks(allChunks, deps.embeddingProvider)
    await upsertKnowledgeChunks({
      projectId,
      origin: 'source',
      originId: sourceId,
      chunks: embedded,
      sql: deps.sql,
    })

    const tokenTotal = allChunks.reduce((s, c) => s + c.tokenCount, 0)

    return { fileCount, chunkCount: embedded.length, tokenTotal, skippedCount }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}
