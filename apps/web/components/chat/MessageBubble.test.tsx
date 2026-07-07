/**
 * XSS sanitization tests for MessageBubble.
 *
 * These tests verify the sanitizeSchema exported from MessageBubble against
 * the three canonical XSS vectors:
 *   1. <script> tag injection
 *   2. Event-handler attributes  (e.g. onerror=, onclick=)
 *   3. javascript: protocol in href / src
 *
 * We test the schema configuration directly (no DOM rendering required) and
 * validate against the invariants that rehype-sanitize enforces at render
 * time via hast-util-sanitize.
 */

import { describe, it, expect } from 'vitest'
import { sanitizeSchema } from './MessageBubble'

// ── Schema-shape tests ─────────────────────────────────────────────────────────

describe('sanitizeSchema — tag allowlist', () => {
  it('does not include <script> in allowed tagNames', () => {
    expect(sanitizeSchema.tagNames).toBeDefined()
    expect(sanitizeSchema.tagNames).not.toContain('script')
  })

  it('does not include <style> in allowed tagNames', () => {
    expect(sanitizeSchema.tagNames).toBeDefined()
    expect(sanitizeSchema.tagNames).not.toContain('style')
  })

  it('does not include <iframe> in allowed tagNames', () => {
    expect(sanitizeSchema.tagNames).not.toContain('iframe')
  })
})

describe('sanitizeSchema — href protocol allowlist', () => {
  it('blocks javascript: in href', () => {
    const hrefProtocols = sanitizeSchema.protocols?.href ?? []
    expect(hrefProtocols).not.toContain('javascript')
  })

  it('allows safe http/https/mailto protocols in href', () => {
    const hrefProtocols = sanitizeSchema.protocols?.href ?? []
    expect(hrefProtocols).toContain('http')
    expect(hrefProtocols).toContain('https')
    expect(hrefProtocols).toContain('mailto')
  })
})

describe('sanitizeSchema — src protocol allowlist', () => {
  it('blocks javascript: in src', () => {
    const srcProtocols = sanitizeSchema.protocols?.src ?? []
    expect(srcProtocols).not.toContain('javascript')
  })

  it('blocks data: URIs in src (prevents <img src="data:..."> XSS)', () => {
    const srcProtocols = sanitizeSchema.protocols?.src ?? []
    expect(srcProtocols).not.toContain('data')
  })
})

describe('sanitizeSchema — event-handler attributes', () => {
  /**
   * The wildcard attribute list (*) must not contain any on* handler.
   * defaultSchema already enforces an explicit allowlist, so onerror /
   * onclick / etc. are absent by design — we assert that here.
   */
  it('does not allow onerror in wildcard attributes', () => {
    const wildcardAttrs = sanitizeSchema.attributes?.['*'] ?? []
    const hasEventHandler = (wildcardAttrs as Array<string | string[]>).some((attr) => {
      const name = typeof attr === 'string' ? attr : Array.isArray(attr) ? String(attr[0]) : ''
      return name.startsWith('on')
    })
    expect(hasEventHandler).toBe(false)
  })

  it('does not allow onclick in wildcard attributes', () => {
    const wildcardAttrs = sanitizeSchema.attributes?.['*'] ?? []
    const hasOnClick = (wildcardAttrs as Array<string | string[]>).some((attr) => {
      const name = typeof attr === 'string' ? attr : Array.isArray(attr) ? String(attr[0]) : ''
      return name === 'onclick'
    })
    expect(hasOnClick).toBe(false)
  })

  it('does not allow any attribute starting with "on" in img attributes', () => {
    const imgAttrs = sanitizeSchema.attributes?.['img'] ?? []
    const hasEventHandler = (imgAttrs as Array<string | string[]>).some((attr) => {
      const name = typeof attr === 'string' ? attr : Array.isArray(attr) ? String(attr[0]) : ''
      return name.startsWith('on')
    })
    expect(hasEventHandler).toBe(false)
  })
})

describe('sanitizeSchema — strip list', () => {
  it('includes script in the strip list', () => {
    const strip = sanitizeSchema.strip ?? []
    expect(strip).toContain('script')
  })

  it('includes style in the strip list', () => {
    const strip = sanitizeSchema.strip ?? []
    expect(strip).toContain('style')
  })
})
