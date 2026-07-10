/**
 * Tests for live agent chat UI components and stream store.
 *
 * Coverage:
 *   - ThoughtsCollapse — collapse/expand, streaming vs done header
 *   - StatusTag         — label rendering, amber styling, null guard
 *   - AgentChip        — stop button visibility
 *   - MentionMenu      — filtering, keyboard nav, Escape
 *   - StreamStore      — startStream / appendThought / stopStream
 *   - Security         — streamed HTML content is not executed
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { ThoughtsCollapse } from './ThoughtsCollapse'
import { StatusTag } from './StatusTag'
import type { AgentStatus } from '@/stores/stream-store'
import { AgentChip } from './AgentChip'
import { MentionMenu } from './MentionMenu'
import type { AgentOption } from './MentionMenu'
import { useStreamStore } from '@/stores/stream-store'
import { MessageBubble } from './MessageBubble'
import type { ConversationNode } from '@/lib/stores/chat-store'

// ── Helpers ────────────────────────────────────────────────────────────────────

const AGENTS: AgentOption[] = [
  { personaId: 'p1', slug: 'ceo', name: 'Chief Executive', title: 'CEO', color: '#ef4444' },
  { personaId: 'p2', slug: 'cto', name: 'Chief Technology', title: 'CTO', color: '#3b82f6' },
  { personaId: 'p3', slug: 'cmo', name: 'Chief Marketing', title: 'CMO', color: '#10b981' },
]

function makeAgentNode(personaId: string, text = 'Hello'): ConversationNode {
  return {
    id: 'n1',
    conversationId: 'conv-1',
    projectId: 'proj-1',
    parentId: null,
    depth: 0,
    path: '0001',
    type: 'agent_message',
    authorKind: 'agent',
    authorUserId: null,
    authorPersonaId: personaId,
    content: { text, mentions: [], attachments: [], meta: {} },
    tokenUsage: null,
    createdAt: new Date().toISOString(),
  }
}

// ── ThoughtsCollapse ───────────────────────────────────────────────────────────

describe('ThoughtsCollapse', () => {
  it('collapsed by default; click expands; shows token count', () => {
    render(
      <ThoughtsCollapse thoughts="some deep reasoning" tokenCount={42} isStreaming={false} />,
    )

    const toggle = screen.getByRole('button')

    // Collapsed by default
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('some deep reasoning')).toBeNull()

    // Token count visible in header
    expect(toggle.textContent).toContain('42 tokens')

    // Click expands
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('some deep reasoning')).toBeInTheDocument()
  })

  it('streaming header says "Thinking…"; done header says "Thoughts"', () => {
    const { rerender } = render(
      <ThoughtsCollapse thoughts="..." tokenCount={5} isStreaming={true} />,
    )

    expect(screen.getByRole('button').textContent).toContain('Thinking…')

    rerender(<ThoughtsCollapse thoughts="..." tokenCount={5} isStreaming={false} />)

    expect(screen.getByRole('button').textContent).toContain('Thoughts')
    expect(screen.getByRole('button').textContent).not.toContain('Thinking')
  })
})

// ── StatusTag ──────────────────────────────────────────────────────────────────

describe('StatusTag', () => {
  it('renders the correct label for each of the 5 statuses', () => {
    const cases: Array<[AgentStatus, string]> = [
      ['invoking_subagent', 'Invoking Sub-Agent'],
      ['reading_database', 'Reading Database via MCP'],
      ['running_code', 'Running Code'],
      ['generating_artifact', 'Generating Artifact'],
      ['waiting_for_approval', 'Waiting for Approval'],
    ]

    for (const [status, label] of cases) {
      const { unmount } = render(<StatusTag status={status} />)
      expect(screen.getByText(label)).toBeInTheDocument()
      unmount()
    }
  })

  it('waiting_for_approval uses amber styling', () => {
    render(<StatusTag status="waiting_for_approval" />)
    const el = screen.getByRole('status')
    // Tailwind class contains "amber"
    expect(el.className).toMatch(/amber/)
  })

  it('returns null when status is null', () => {
    const { container } = render(<StatusTag status={null} />)
    expect(container.firstChild).toBeNull()
  })
})

// ── AgentChip ─────────────────────────────────────────────────────────────────

describe('AgentChip', () => {
  it('stop button is NOT rendered when isStreaming=false', () => {
    render(
      <AgentChip
        personaId="p1"
        name="Chief Executive"
        slug="ceo"
        color="#ef4444"
        isStreaming={false}
        onStop={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull()
  })

  it('stop button IS rendered when isStreaming=true; click calls onStop', () => {
    const onStop = vi.fn()
    render(
      <AgentChip
        personaId="p1"
        name="Chief Executive"
        slug="ceo"
        color="#ef4444"
        isStreaming={true}
        onStop={onStop}
      />,
    )

    const stopBtn = screen.getByRole('button', { name: /stop/i })
    expect(stopBtn).toBeInTheDocument()

    fireEvent.click(stopBtn)
    expect(onStop).toHaveBeenCalledOnce()
  })
})

// ── MentionMenu ───────────────────────────────────────────────────────────────

describe('MentionMenu', () => {
  it('filters agents by slug startsWith query', () => {
    render(
      <MentionMenu
        query="ct"
        agents={AGENTS}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    // Only 'cto' slug starts with 'ct'
    const items = screen.getAllByRole('option')
    expect(items).toHaveLength(1)
     
    expect(items[0]!.textContent).toContain('cto')
  })

  it('keyboard nav: ArrowDown moves selection down, ArrowUp moves it up, Enter selects', () => {
    const onSelect = vi.fn()

    render(
      <MentionMenu
        query=""
        agents={AGENTS}
        onSelect={onSelect}
        onDismiss={vi.fn()}
      />,
    )

    // Initially first item selected
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'false')

    // ArrowDown → second selected
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'false')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')

    // ArrowUp → back to first
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')

    // Enter → selects first agent
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(AGENTS[0])
  })

  it('Escape calls onDismiss', () => {
    const onDismiss = vi.fn()

    render(
      <MentionMenu
        query=""
        agents={AGENTS}
        onSelect={vi.fn()}
        onDismiss={onDismiss}
      />,
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})

// ── StreamStore ───────────────────────────────────────────────────────────────

describe('StreamStore', () => {
  beforeEach(() => {
    // Reset store between tests
    useStreamStore.setState({ streams: new Map() })
  })

  it('startStream creates an entry with isStreaming=true and empty content', () => {
    useStreamStore.getState().startStream('p1', { name: 'CEO', slug: 'ceo', color: '#ef4444' })
    const stream = useStreamStore.getState().streams.get('p1')
    expect(stream).toBeDefined()
    expect(stream?.isStreaming).toBe(true)
    expect(stream?.thoughts).toBe('')
    expect(stream?.thoughtTokens).toBe(0)
    expect(stream?.content).toBe('')
    expect(stream?.nodeId).toBeNull()
  })

  it('appendThought concatenates text and increments thoughtTokens', () => {
    useStreamStore.getState().startStream('p1', { name: 'CEO', slug: 'ceo', color: '#ef4444' })
    useStreamStore.getState().appendThought('p1', 'hello world')

    const stream = useStreamStore.getState().streams.get('p1')
    expect(stream?.thoughts).toBe('hello world')
    // Math.ceil(11 / 4) = 3
    expect(stream?.thoughtTokens).toBe(Math.ceil('hello world'.length / 4))
  })

  it('stopStream sets isStreaming=false and records nodeId', () => {
    useStreamStore.getState().startStream('p1', { name: 'CEO', slug: 'ceo', color: '#ef4444' })
    useStreamStore.getState().stopStream('p1', 'node-abc')

    const stream = useStreamStore.getState().streams.get('p1')
    expect(stream?.isStreaming).toBe(false)
    expect(stream?.nodeId).toBe('node-abc')
    expect(stream?.status).toBeNull()
  })
})

// ── Security ──────────────────────────────────────────────────────────────────

describe('Security — streamed content XSS prevention', () => {
  afterEach(() => {
    useStreamStore.setState({ streams: new Map() })
  })

  it('streaming content containing <script> renders as text, not executable HTML', () => {
    // Populate the stream store with a malicious content string
    useStreamStore.setState({
      streams: new Map([
        [
          'agent-sec',
          {
            personaId: 'agent-sec',
            name: 'CEO',
            slug: 'ceo',
            color: '#ef4444',
            thoughts: '',
            thoughtTokens: 0,
            content: '<script>alert(1)</script>',
            isStreaming: true,
            nodeId: null,
            status: null,
          },
        ],
      ]),
    })

    const { container } = render(
      <MessageBubble node={makeAgentNode('agent-sec', 'Base text')} onBranch={vi.fn()} />,
    )

    // No live <script> elements in the DOM
    expect(container.querySelector('script')).toBeNull()
    // The script tag appears as escaped text content, not an element
    expect(container.innerHTML).not.toContain('<script>')
    // Text content should include the literal string
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })
})
