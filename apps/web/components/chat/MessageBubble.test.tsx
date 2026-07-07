/**
 * XSS sanitization rendering tests for MessageBubble.
 *
 * Each test renders the component with a malicious markdown payload and
 * asserts that the harmful content is neutralised in the output DOM.
 * All tests run in the jsdom environment so that actual DOM nodes are
 * produced and inspected — not just schema config.
 */

import React from 'react'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MessageBubble } from './MessageBubble'
import type { ConversationNode } from '@/lib/stores/chat-store'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeNode(text: string): ConversationNode {
  return {
    id: 'test-id',
    conversationId: 'conv-id',
    projectId: 'proj-id',
    parentId: null,
    depth: 0,
    path: '0001',
    type: 'user_message',
    authorKind: 'user',
    authorUserId: 'user-id',
    authorPersonaId: null,
    content: { text, mentions: [], attachments: [], meta: {} },
    tokenUsage: null,
    createdAt: new Date().toISOString(),
  }
}

// ── XSS corpus ─────────────────────────────────────────────────────────────────

describe('MessageBubble — XSS rendering corpus', () => {
  it('<img onerror="alert(1)"> — onerror attribute absent from rendered DOM', () => {
    const { container } = render(
      <MessageBubble
        node={makeNode('<img src=x onerror="alert(1)">')}
        onBranch={() => {}}
      />,
    )
    // remark strips raw HTML by default; rehype-sanitize also removes onerror
    expect(container.innerHTML).not.toMatch(/onerror\s*=/i)
    expect(container.querySelector('[onerror]')).toBeNull()
  })

  it('[click](javascript:alert(1)) — href must not contain javascript: protocol', () => {
    const { container } = render(
      <MessageBubble
        node={makeNode('[click me](javascript:alert(1))')}
        onBranch={() => {}}
      />,
    )
    // rehype-sanitize strips href when the protocol is not in the allowlist
    const anchors = Array.from(container.querySelectorAll('a'))
    for (const a of anchors) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
    }
  })

  it('<script>alert(1)</script> — no script element in rendered DOM', () => {
    const { container } = render(
      <MessageBubble
        node={makeNode('<script>alert(document.cookie)</script>')}
        onBranch={() => {}}
      />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('<script')
  })

  it('<iframe src="evil.com"> — no iframe element in rendered DOM', () => {
    const { container } = render(
      <MessageBubble
        node={makeNode('<iframe src="https://evil.com"></iframe>')}
        onBranch={() => {}}
      />,
    )
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('[x](data:text/html,...) — data: href stripped from links', () => {
    const { container } = render(
      <MessageBubble
        node={makeNode('[x](data:text/html,<script>alert(1)</script>)')}
        onBranch={() => {}}
      />,
    )
    const anchors = Array.from(container.querySelectorAll('a'))
    for (const a of anchors) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^data:/i)
    }
  })

  it('<style> injection — no style element in rendered DOM', () => {
    const { container } = render(
      <MessageBubble
        node={makeNode('<style>body { display: none }</style>')}
        onBranch={() => {}}
      />,
    )
    expect(container.querySelector('style')).toBeNull()
  })

  it('<span onclick="..."> — onclick attribute absent', () => {
    const { container } = render(
      <MessageBubble
        node={makeNode('<span onclick="alert(1)">click</span>')}
        onBranch={() => {}}
      />,
    )
    expect(container.innerHTML).not.toMatch(/onclick\s*=/i)
    expect(container.querySelector('[onclick]')).toBeNull()
  })

  it('no element in the output carries any on* event attribute', () => {
    const { container } = render(
      <MessageBubble
        node={makeNode('**bold** [link](https://safe.example.com) *italic*')}
        onBranch={() => {}}
      />,
    )
    const allElements = Array.from(container.querySelectorAll('*'))
    for (const el of allElements) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.toLowerCase()).not.toMatch(/^on/)
      }
    }
  })

  it('safe https link passes through unmodified', () => {
    const { container } = render(
      <MessageBubble
        node={makeNode('[Visit](https://example.com)')}
        onBranch={() => {}}
      />,
    )
    const a = container.querySelector('a')
    expect(a).not.toBeNull()
    expect(a?.getAttribute('href')).toBe('https://example.com')
  })

  it('plain text renders without injecting any HTML tags', () => {
    const { container } = render(
      <MessageBubble
        node={makeNode('Hello, <world>!')}
        onBranch={() => {}}
      />,
    )
    expect(container.querySelector('world')).toBeNull()
    expect(container.textContent).toContain('Hello,')
  })
})
