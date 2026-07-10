/**
 * URL crawl sync strategy.
 *
 * BFS crawl from rootUrl, same-origin only, respects robots.txt.
 *
 * Security / limits:
 *   - Same-origin enforcement (no cross-domain follows)
 *   - Robots.txt honored (Disallow for User-agent: *)
 *   - depth ≤ min(3, config.maxDepth)
 *   - pages ≤ min(200, config.maxPages)
 *   - No JS execution (pure fetch)
 */
import type { EmbeddingProvider } from '@bramha/agents'
import type postgres from 'postgres'
import { chunkSections } from '../chunking.js'
import { embedChunks } from '../embedder.js'
import { upsertKnowledgeChunks } from '../knowledge-writer.js'

// ── Interface ─────────────────────────────────────────────────────────────────

export interface UrlSyncConfig {
  rootUrl: string
  maxDepth?: number
  maxPages?: number
}

export interface UrlSyncDeps {
  sql: postgres.Sql
  embeddingProvider: EmbeddingProvider
  /** Override fetch for testing */
  fetchFn?: typeof fetch
}

export interface UrlSyncResult {
  pageCount: number
  chunkCount: number
  tokenTotal: number
  skippedCount: number
}

// ── Robots.txt parser ─────────────────────────────────────────────────────────

interface RobotRules {
  disallowed: string[]
}

async function fetchRobotsTxt(origin: string, fetchFn: typeof fetch): Promise<RobotRules> {
  try {
    const res = await fetchFn(`${origin}/robots.txt`, {
      headers: { 'User-Agent': 'BramhaBot/1.0' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return { disallowed: [] }
    const text = await res.text()
    return parseRobotsTxt(text)
  } catch {
    return { disallowed: [] }
  }
}

export function parseRobotsTxt(text: string): RobotRules {
  const disallowed: string[] = []
  let inRelevantBlock = false

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#') || line === '') continue

    if (line.toLowerCase().startsWith('user-agent:')) {
      const agent = line.slice('user-agent:'.length).trim()
      inRelevantBlock = agent === '*'
      continue
    }

    if (inRelevantBlock && line.toLowerCase().startsWith('disallow:')) {
      const path = line.slice('disallow:'.length).trim()
      if (path) disallowed.push(path)
    }
  }

  return { disallowed }
}

export function isRobotsAllowed(url: string, rules: RobotRules): boolean {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return false
  }
  for (const disallow of rules.disallowed) {
    if (pathname.startsWith(disallow)) return false
  }
  return true
}

// ── HTML text extractor ───────────────────────────────────────────────────────

export function extractTextFromHtml(html: string): string {
  // Strip script / style blocks
  let text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')

  // Replace block elements with newlines to preserve structure
  text = text
    .replace(/<(h[1-6]|p|div|li|tr|br|blockquote)[^>]*>/gi, '\n')
    .replace(/<\/?(h[1-6]|p|div|li|tr|blockquote)>/gi, '\n')

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, ' ')

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')

  // Collapse whitespace
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

/** Extract same-origin links from HTML. */
export function extractLinks(html: string, currentUrl: string, origin: string): string[] {
  const links: string[] = []
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi
  let match: RegExpExecArray | null

  while ((match = hrefRe.exec(html)) !== null) {
    const href = match[1]
    if (!href) continue
    try {
      const absolute = new URL(href, currentUrl).href
      const linkOrigin = new URL(absolute).origin
      // Same-origin check
      if (linkOrigin !== origin) continue
      // Only http/https
      if (!absolute.startsWith('http')) continue
      // Skip anchors-only and common non-content extensions
      const path = new URL(absolute).pathname
      if (/\.(jpg|jpeg|png|gif|svg|ico|css|js|woff|woff2|pdf|zip)$/i.test(path)) continue
      links.push(absolute.split('#')[0]!) // strip fragment
    } catch {
      // ignore malformed URLs
    }
  }

  return [...new Set(links)]
}

// ── Main sync function ────────────────────────────────────────────────────────

export async function syncUrl(
  projectId: string,
  sourceId: string,
  config: UrlSyncConfig,
  deps: UrlSyncDeps,
): Promise<UrlSyncResult> {
  const { rootUrl, maxDepth = 2, maxPages = 50 } = config

  const effectiveMaxDepth = Math.min(3, maxDepth)
  const effectiveMaxPages = Math.min(200, maxPages)

  const rootOrigin = new URL(rootUrl).origin
  const fetchFn = deps.fetchFn ?? fetch

  // Fetch robots.txt
  const robots = await fetchRobotsTxt(rootOrigin, fetchFn)

  // BFS queue: [url, depth]
  const queue: Array<[string, number]> = [[rootUrl, 0]]
  const visited = new Set<string>([rootUrl])
  const sections: Array<{ headingTrail: string[]; text: string }> = []
  let skippedCount = 0

  while (queue.length > 0 && sections.length < effectiveMaxPages) {
    const item = queue.shift()
    if (!item) break
    const [url, depth] = item

    // robots.txt check
    if (!isRobotsAllowed(url, robots)) {
      skippedCount++
      continue
    }

    let html: string
    try {
      const res = await fetchFn(url, {
        headers: { 'User-Agent': 'BramhaBot/1.0' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        skippedCount++
        continue
      }
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('text/html')) {
        skippedCount++
        continue
      }
      html = await res.text()
    } catch {
      skippedCount++
      continue
    }

    const text = extractTextFromHtml(html)
    if (text.length > 20) {
      sections.push({ headingTrail: [url], text })
    }

    // Enqueue child links if under depth cap
    if (depth < effectiveMaxDepth) {
      const links = extractLinks(html, url, rootOrigin)
      for (const link of links) {
        if (!visited.has(link) && visited.size < effectiveMaxPages * 2) {
          visited.add(link)
          queue.push([link, depth + 1])
        }
      }
    }
  }

  if (sections.length === 0) {
    return { pageCount: 0, chunkCount: 0, tokenTotal: 0, skippedCount }
  }

  const chunks = chunkSections(sections)
  const embedded = await embedChunks(chunks, deps.embeddingProvider)
  await upsertKnowledgeChunks({
    projectId,
    origin: 'source',
    originId: sourceId,
    chunks: embedded,
    sql: deps.sql,
  })

  const tokenTotal = chunks.reduce((s, c) => s + c.tokenCount, 0)

  return { pageCount: sections.length, chunkCount: embedded.length, tokenTotal, skippedCount }
}
