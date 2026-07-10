/**
 * URL sync strategy tests.
 *
 * Tests:
 * 1. robots.txt respected: URL in Disallow → skipped
 * 2. Same-origin enforced: external link → not followed
 * 3. Depth cap: links beyond maxDepth → skipped
 * 4. Page cap: stops at maxPages
 */
import { describe, it, expect, vi } from 'vitest'
import {
  parseRobotsTxt,
  isRobotsAllowed,
  extractTextFromHtml,
  extractLinks,
  syncUrl,
} from './url-sync.js'
import type { EmbeddingProvider } from '@bramha/agents'
import type postgres from 'postgres'

// ── parseRobotsTxt ─────────────────────────────────────────────────────────────

describe('parseRobotsTxt', () => {
  it('parses Disallow rules for User-agent: *', () => {
    const rules = parseRobotsTxt(`
User-agent: *
Disallow: /admin/
Disallow: /private/
Allow: /

User-agent: Googlebot
Disallow: /no-google/
`)
    expect(rules.disallowed).toContain('/admin/')
    expect(rules.disallowed).toContain('/private/')
    // Googlebot-only Disallow should NOT be included
    expect(rules.disallowed).not.toContain('/no-google/')
  })

  it('returns empty disallowed for empty robots.txt', () => {
    expect(parseRobotsTxt('')).toEqual({ disallowed: [] })
  })
})

// ── isRobotsAllowed ───────────────────────────────────────────────────────────

describe('isRobotsAllowed', () => {
  const rules = parseRobotsTxt(`
User-agent: *
Disallow: /admin/
Disallow: /secret
`)

  it('blocks disallowed path', () => {
    expect(isRobotsAllowed('https://example.com/admin/dashboard', rules)).toBe(false)
  })

  it('allows non-disallowed path', () => {
    expect(isRobotsAllowed('https://example.com/docs/intro', rules)).toBe(true)
  })

  it('blocks exact disallowed path', () => {
    expect(isRobotsAllowed('https://example.com/secret', rules)).toBe(false)
  })

  it('blocks subpath of disallowed', () => {
    expect(isRobotsAllowed('https://example.com/admin/users', rules)).toBe(false)
  })
})

// ── extractTextFromHtml ───────────────────────────────────────────────────────

describe('extractTextFromHtml', () => {
  it('strips tags and extracts text', () => {
    const html = '<h1>Hello</h1><p>World</p><script>evil()</script>'
    const text = extractTextFromHtml(html)
    expect(text).toContain('Hello')
    expect(text).toContain('World')
    expect(text).not.toContain('evil()')
    expect(text).not.toContain('<h1>')
  })
})

// ── extractLinks ──────────────────────────────────────────────────────────────

describe('extractLinks', () => {
  it('returns same-origin links', () => {
    const html = '<a href="/docs">Docs</a><a href="https://example.com/about">About</a>'
    const links = extractLinks(html, 'https://example.com/', 'https://example.com')
    expect(links).toContain('https://example.com/docs')
    expect(links).toContain('https://example.com/about')
  })

  it('excludes cross-origin links', () => {
    const html = '<a href="https://evil.com/attack">Evil</a><a href="/safe">Safe</a>'
    const links = extractLinks(html, 'https://example.com/', 'https://example.com')
    expect(links).not.toContain('https://evil.com/attack')
    expect(links).toContain('https://example.com/safe')
  })

  it('excludes asset extensions', () => {
    const html = '<a href="/image.png">Img</a><a href="/doc.pdf">PDF</a>'
    const links = extractLinks(html, 'https://example.com/', 'https://example.com')
    expect(links).not.toContain('https://example.com/image.png')
    expect(links).not.toContain('https://example.com/doc.pdf')
  })
})

// ── syncUrl integration-style tests ───────────────────────────────────────────

function makeEmbeddingProvider(): EmbeddingProvider {
  return {
    embed: vi.fn().mockImplementation(async (texts: string[]) => texts.map(() => new Array(1536).fill(0))),
    dimension: 1536,
    model: 'mock',
  }
}

function makeSql(): postgres.Sql {
  const sqlFn = vi.fn().mockResolvedValue([]) as unknown as postgres.Sql
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyFn = sqlFn as any
  anyFn.begin = vi.fn().mockImplementation(async (_mode: unknown, cb: (tx: unknown) => unknown) => {
    if (cb) return cb(sqlFn)
    return []
  })
  anyFn.unsafe = vi.fn().mockResolvedValue([])
  return sqlFn
}

describe('syncUrl — robots.txt enforcement', () => {
  it('skips URLs listed in Disallow', async () => {
    const fetchedUrls: string[] = []

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      fetchedUrls.push(url)

      if (url.endsWith('/robots.txt')) {
        return {
          ok: true,
          text: async () => 'User-agent: *\nDisallow: /secret/',
          headers: { get: () => 'text/plain' },
        }
      }

      // root page with link to /secret/
      if (url === 'https://example.com/') {
        return {
          ok: true,
          headers: { get: () => 'text/html; charset=utf-8' },
          text: async () => '<html><body><h1>Home</h1><a href="/secret/page">Secret</a></body></html>',
        }
      }

      // /secret/page should never be fetched
      return { ok: false, headers: { get: () => 'text/html' }, text: async () => '' }
    })

    const sql = makeSql()
    const embeddingProvider = makeEmbeddingProvider()

    await syncUrl('proj-1', 'source-1', { rootUrl: 'https://example.com/', maxDepth: 2, maxPages: 10 }, {
      sql,
      embeddingProvider,
      fetchFn: mockFetch as typeof fetch,
    })

    // /secret/page must not have been fetched
    expect(fetchedUrls).not.toContain('https://example.com/secret/page')
  })
})

describe('syncUrl — same-origin enforcement', () => {
  it('does not follow cross-origin links', async () => {
    const fetchedUrls: string[] = []

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      fetchedUrls.push(url)

      if (url.endsWith('/robots.txt')) {
        return { ok: true, text: async () => '', headers: { get: () => 'text/plain' } }
      }

      if (url === 'https://example.com/') {
        return {
          ok: true,
          headers: { get: () => 'text/html' },
          text: async () => '<html><body><a href="https://evil.com/steal">Evil</a><a href="/local">Local</a></body></html>',
        }
      }

      if (url === 'https://example.com/local') {
        return {
          ok: true,
          headers: { get: () => 'text/html' },
          text: async () => '<html><body>Local page content here</body></html>',
        }
      }

      return { ok: false, headers: { get: () => 'text/html' }, text: async () => '' }
    })

    const sql = makeSql()
    const embeddingProvider = makeEmbeddingProvider()

    await syncUrl('proj-1', 'source-1', { rootUrl: 'https://example.com/', maxDepth: 2, maxPages: 10 }, {
      sql,
      embeddingProvider,
      fetchFn: mockFetch as typeof fetch,
    })

    const crossOriginFetched = fetchedUrls.some(u => u.startsWith('https://evil.com'))
    expect(crossOriginFetched).toBe(false)
  })
})

describe('syncUrl — depth cap', () => {
  it('does not follow links beyond maxDepth', async () => {
    const fetchedUrls: string[] = []

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      fetchedUrls.push(url)

      if (url.endsWith('/robots.txt')) {
        return { ok: true, text: async () => '', headers: { get: () => 'text/plain' } }
      }

      // depth 0: root
      if (url === 'https://example.com/') {
        return {
          ok: true,
          headers: { get: () => 'text/html' },
          text: async () => '<html><body>Root<a href="/level1">Level1</a></body></html>',
        }
      }
      // depth 1
      if (url === 'https://example.com/level1') {
        return {
          ok: true,
          headers: { get: () => 'text/html' },
          text: async () => '<html><body>Level1<a href="/level2">Level2</a></body></html>',
        }
      }
      // depth 2 (at maxDepth=1, this should NOT be fetched)
      if (url === 'https://example.com/level2') {
        return {
          ok: true,
          headers: { get: () => 'text/html' },
          text: async () => '<html><body>Level2</body></html>',
        }
      }

      return { ok: false, headers: { get: () => 'text/html' }, text: async () => '' }
    })

    const sql = makeSql()
    const embeddingProvider = makeEmbeddingProvider()

    await syncUrl('proj-1', 'source-1', { rootUrl: 'https://example.com/', maxDepth: 1, maxPages: 10 }, {
      sql,
      embeddingProvider,
      fetchFn: mockFetch as typeof fetch,
    })

    // level2 should NOT have been fetched (depth 2 > maxDepth 1)
    expect(fetchedUrls).not.toContain('https://example.com/level2')
  })
})

describe('syncUrl — page cap', () => {
  it('stops at maxPages', async () => {
    const MAX_PAGES = 3
    let pageCount = 0

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return { ok: true, text: async () => '', headers: { get: () => 'text/plain' } }
      }

      // Generate pages with links to more pages
      pageCount++
      const links = Array.from({ length: 5 }, (_, i) => `<a href="/page${pageCount * 10 + i}">P</a>`).join('')
      return {
        ok: true,
        headers: { get: () => 'text/html' },
        text: async () => `<html><body>Page content ${pageCount} ${links}</body></html>`,
      }
    })

    const sql = makeSql()
    const embeddingProvider = makeEmbeddingProvider()

    const result = await syncUrl('proj-1', 'source-1', { rootUrl: 'https://example.com/', maxDepth: 3, maxPages: MAX_PAGES }, {
      sql,
      embeddingProvider,
      fetchFn: mockFetch as typeof fetch,
    })

    expect(result.pageCount).toBeLessThanOrEqual(MAX_PAGES)
  })
})
