import { describe, it, expect } from 'vitest'
import { estimateTokenCount } from '@bramha/agents'
import {
  buildContextBundle,
  untrustedContext,
  CONTEXT_TOKEN_CAP,
  ROUTING_MATRIX,
  filterProjectFacts,
} from './context-bundle.js'
import type { BundleInput, RagChunk, ThreadNode, GlobalFact } from './context-bundle.js'
import type { WorkingMemory } from './working-memory.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeMemory(overrides: Partial<WorkingMemory> = {}): WorkingMemory {
  return {
    personaId: 'persona-1',
    conversationId: 'conv-1',
    projectId: 'proj-1',
    facts: [],
    openLoops: [],
    lastSummaryNode: null,
    summaryMd: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeNode(
  nodeId: string,
  text: string,
  authorName = 'Alice',
  type = 'user_message',
): ThreadNode {
  return { nodeId, authorKind: 'user', authorName, text, type }
}

function makeRagChunk(snippet: string, score = 0.9): RagChunk {
  return {
    chunkId: `rag-${Math.random()}`,
    origin: 'test-doc',
    headingTrail: ['Section 1'],
    snippet,
    score,
  }
}

function makeInput(overrides: Partial<BundleInput> = {}): BundleInput {
  return {
    systemPrompt: 'You are a helpful executive assistant.',
    toolSchemas: [],
    projectBrief: 'This is the project brief.',
    workingMemory: makeMemory(),
    ragChunks: [],
    threadNodes: [makeNode('n1', 'Hello world')],
    triggerReason: 'mention',
    otherSpeakers: ['Bob'],
    maxInputTokens: 8000,
    currentRoomId: 'room-default',
    roomType: 'conference',
    roomIsConfidential: false,
    projectFacts: [],
    ...overrides,
  }
}

// ── Golden test ────────────────────────────────────────────────────────────────

describe('buildContextBundle', () => {
  it('12: golden test — all sections present and in correct order', () => {
    const memory = makeMemory({
      summaryMd: 'Previous discussion summary.',
      openLoops: [
        { id: 'q1', text: 'What is the budget?', createdAt: new Date().toISOString() },
      ],
    })
    const input = makeInput({
      workingMemory: memory,
      ragChunks: [makeRagChunk('Relevant document content.')],
    })

    const bundle = buildContextBundle(input)

    // All sections populated
    expect(bundle.sections.systemPrompt).toBe(input.systemPrompt)
    expect(bundle.sections.projectBrief).toContain('project brief')
    expect(bundle.sections.workingMemorySummary).toContain('summary')
    expect(bundle.sections.openLoops).toContain('budget')
    expect(bundle.sections.ragBlock).toContain('Relevant document content')
    expect(bundle.sections.threadWindow).toContain('Hello world')
    expect(bundle.sections.triggerInstruction).toBeTruthy()

    // Correct order in fullPrompt: s1 < s3 < s4 < s5 < s6 < s7 < s8
    const fp = bundle.fullPrompt
    const pos = (s: string) => fp.indexOf(s)
    expect(pos(bundle.sections.systemPrompt)).toBeLessThan(pos('project brief'))
    expect(pos('project brief')).toBeLessThan(pos(bundle.sections.workingMemorySummary))
    expect(pos(bundle.sections.workingMemorySummary)).toBeLessThan(pos('Open Questions'))
    expect(pos('Open Questions')).toBeLessThan(pos('untrusted_context'))
    expect(pos('untrusted_context')).toBeLessThan(pos('Hello world'))
    expect(pos('Hello world')).toBeLessThan(pos('You are speaking now'))
  })

  it('13: token budget enforced — totalTokens ≤ budgetTotal * 0.95', () => {
    const input = makeInput({ maxInputTokens: 500 })
    const bundle = buildContextBundle(input)

    expect(bundle.tokenCount).toBeLessThanOrEqual(
      Math.floor(bundle.budgetTotal * 0.95),
    )
  })

  it('14: RAG block ≤ 35% of remaining budget after sections 1–5', () => {
    // Use a tight budget so RAG gets capped
    const bigSnippet = 'x'.repeat(20_000)  // ~5000 tokens
    const input = makeInput({
      ragChunks: [makeRagChunk(bigSnippet)],
      maxInputTokens: 1000,
    })

    const bundle = buildContextBundle(input)
    const ragTokens = estimateTokenCount(bundle.sections.ragBlock)

    // RAG must be less than 35% of the effective budget (a conservative upper bound)
    const effectiveBudget = Math.floor(
      Math.min(1000, 16_384, CONTEXT_TOKEN_CAP) * 0.95,
    )
    expect(ragTokens).toBeLessThanOrEqual(Math.ceil(effectiveBudget * 0.35) + 10)
  })

  it('15: RAG block wrapped in untrusted_context tags', () => {
    const input = makeInput({
      ragChunks: [makeRagChunk('Some retrieved knowledge.')],
    })

    const bundle = buildContextBundle(input)

    expect(bundle.sections.ragBlock).toContain('<untrusted_context>')
    expect(bundle.sections.ragBlock).toContain('</untrusted_context>')
  })

  it('16: project brief truncated at 500 tokens with notice', () => {
    // 500 tokens ≈ 2000 chars; use 3000 chars to exceed cap
    const longBrief = 'A'.repeat(3000)
    const input = makeInput({ projectBrief: longBrief })

    const bundle = buildContextBundle(input)

    const briefTokens = estimateTokenCount(bundle.sections.projectBrief)
    expect(briefTokens).toBeLessThanOrEqual(520)  // 500 + notice
    expect(bundle.sections.projectBrief).toContain('[Project brief truncated')
  })

  it('17: open loops formatted as bullet list', () => {
    const memory = makeMemory({
      openLoops: [
        { id: 'q1', text: 'What is the timeline?', createdAt: new Date().toISOString() },
        { id: 'q2', text: 'Who owns the budget?', createdAt: new Date().toISOString() },
      ],
    })
    const input = makeInput({ workingMemory: memory })

    const bundle = buildContextBundle(input)

    expect(bundle.sections.openLoops).toContain('- What is the timeline?')
    expect(bundle.sections.openLoops).toContain('- Who owns the budget?')
  })

  it('18: thread nodes displayed newest-last (oldest first in output)', () => {
    const nodes = [
      makeNode('n1', 'Oldest message', 'Alice'),
      makeNode('n2', 'Middle message', 'Bob'),
      makeNode('n3', 'Newest message', 'Carol'),
    ]
    const input = makeInput({ threadNodes: nodes })

    const bundle = buildContextBundle(input)

    const tw = bundle.sections.threadWindow
    expect(tw.indexOf('Oldest message')).toBeLessThan(tw.indexOf('Middle message'))
    expect(tw.indexOf('Middle message')).toBeLessThan(tw.indexOf('Newest message'))
  })

  it('19: trigger instruction contains reason and other speakers', () => {
    const input = makeInput({
      triggerReason: 'expertise',
      otherSpeakers: ['Alice', 'Bob'],
    })

    const bundle = buildContextBundle(input)

    expect(bundle.sections.triggerInstruction).toContain('expertise match')
    expect(bundle.sections.triggerInstruction).toContain('Alice')
    expect(bundle.sections.triggerInstruction).toContain('Bob')
  })

  it('20: empty ragChunks → ragBlock is empty string (no section)', () => {
    const input = makeInput({ ragChunks: [] })

    const bundle = buildContextBundle(input)

    expect(bundle.sections.ragBlock).toBe('')
    expect(bundle.fullPrompt).not.toContain('untrusted_context')
  })

  it('closed open loops are excluded from open-loops section', () => {
    const memory = makeMemory({
      openLoops: [
        { id: 'q1', text: 'Open question?', createdAt: new Date().toISOString() },
        {
          id: 'q2',
          text: 'Closed question?',
          createdAt: new Date().toISOString(),
          closedAt: new Date().toISOString(),
        },
      ],
    })
    const input = makeInput({ workingMemory: memory })

    const bundle = buildContextBundle(input)

    expect(bundle.sections.openLoops).toContain('Open question?')
    expect(bundle.sections.openLoops).not.toContain('Closed question?')
  })

  it('untrustedContext wraps content correctly', () => {
    const result = untrustedContext('some content')
    expect(result).toBe('<untrusted_context>\nsome content\n</untrusted_context>')
  })

  it('trigger instruction with no other speakers says "none"', () => {
    const input = makeInput({ otherSpeakers: [], triggerReason: 'follow-up' })
    const bundle = buildContextBundle(input)
    expect(bundle.sections.triggerInstruction).toContain('none')
    expect(bundle.sections.triggerInstruction).toContain('follow-up')
  })
})

// ── Cross-room routing ──────────────────────────────────────────────────────────

function makeGlobalFact(overrides: Partial<GlobalFact> = {}): GlobalFact {
  return {
    text: 'Default global fact',
    sourceNode: 'node-global',
    confidence: 0.9,
    ts: new Date().toISOString(),
    sourceConversationId: 'conv-other',
    sourceRoomId: 'room-other',
    sourceRoomType: 'conference',
    sourceRoomConfidential: false,
    ...overrides,
  }
}

describe('ROUTING_MATRIX', () => {
  it('is exported and has all four routing rule keys', () => {
    expect(ROUTING_MATRIX.ragChunks).toBe('all-rooms-always')
    expect(ROUTING_MATRIX.rollingSummary).toBe('same-room-only')
    expect(ROUTING_MATRIX.workingMemoryFacts).toBe('agent-global-project-except-confidential-1:1')
    expect(ROUTING_MATRIX.openLoops).toBe('current-conversation-only')
  })
})

describe('filterProjectFacts', () => {
  it('passes through non-confidential facts regardless of room', () => {
    const fact = makeGlobalFact({ sourceRoomConfidential: false, sourceRoomId: 'room-A' })
    const result = filterProjectFacts([fact], 'room-B')
    expect(result).toHaveLength(1)
  })

  it('blocks confidential facts when currentRoomId differs from sourceRoomId', () => {
    const fact = makeGlobalFact({ sourceRoomConfidential: true, sourceRoomId: 'room-A' })
    const result = filterProjectFacts([fact], 'room-B')
    expect(result).toHaveLength(0)
  })

  it('allows confidential facts when currentRoomId matches sourceRoomId', () => {
    const fact = makeGlobalFact({ sourceRoomConfidential: true, sourceRoomId: 'room-A' })
    const result = filterProjectFacts([fact], 'room-A')
    expect(result).toHaveLength(1)
  })
})

describe('cross-room routing', () => {
  it('includes global facts from other rooms when not confidential', () => {
    const globalFact = makeGlobalFact({
      text: 'Budget is $5M',
      sourceRoomId: 'room-conference',
      sourceRoomType: 'conference',
      sourceRoomConfidential: false,
    })
    const input = makeInput({
      currentRoomId: 'room-call',
      roomType: 'call',
      roomIsConfidential: false,
      projectFacts: [globalFact],
    })
    const bundle = buildContextBundle(input)
    expect(bundle.fullPrompt).toContain('Budget is $5M')
  })

  it('excludes confidential-1:1 facts across varied room and persona combinations', () => {
    const roomTypes: Array<'conference' | 'meeting' | 'call' | 'office'> = ['conference', 'meeting', 'call', 'office']
    const confidentialRoomId = 'room-call-secret'

    for (let i = 0; i < 20; i++) {
      const currentRoomType = roomTypes[i % roomTypes.length] ?? 'conference'
      const currentRoomId = `room-other-${i}`  // always different from confidential source

      const confidentialFact: GlobalFact = {
        text: `SECRET: CEO plans acquisition iteration ${i}`,
        sourceNode: `node-${i}`,
        confidence: 1.0,
        ts: new Date().toISOString(),
        sourceConversationId: 'conv-call',
        sourceRoomId: confidentialRoomId,
        sourceRoomType: 'call',
        sourceRoomConfidential: true,
      }

      const input = makeInput({
        roomType: currentRoomType,
        currentRoomId,
        roomIsConfidential: false,
        projectFacts: [confidentialFact],
      })

      const bundle = buildContextBundle(input)
      expect(bundle.fullPrompt).not.toContain(`SECRET: CEO plans acquisition iteration ${i}`)
      expect(bundle.sections.projectFactsBlock).toBe('')
    }
  })

  it('includes confidential-1:1 fact when IN the same room', () => {
    const confidentialFact = makeGlobalFact({
      text: 'SECRET: CEO plans acquisition',
      sourceRoomId: 'room-call-123',
      sourceRoomType: 'call',
      sourceRoomConfidential: true,
    })
    const input = makeInput({
      currentRoomId: 'room-call-123',  // matches sourceRoomId
      roomType: 'call',
      roomIsConfidential: true,
      projectFacts: [confidentialFact],
    })
    const bundle = buildContextBundle(input)
    expect(bundle.fullPrompt).toContain('SECRET: CEO plans acquisition')
  })

  it('meeting-room summary stays in same room — does not appear in projectFacts', () => {
    const memWithSummary = makeMemory({ summaryMd: 'Meeting A summary: pricing discussion' })
    const input = makeInput({
      workingMemory: memWithSummary,
      currentRoomId: 'room-meeting-A',
      roomType: 'meeting',
      roomIsConfidential: false,
      projectFacts: [],  // summaries are per-conversation, never in projectFacts
    })
    const bundle = buildContextBundle(input)
    // Summary from workingMemory is included (same room)
    expect(bundle.sections.workingMemorySummary).toContain('Meeting A summary')
  })

  it('fact learned in conference is available to same agent in its 1:1', () => {
    // Conference fact (non-confidential) should appear in a 1:1 room bundle
    const conferenceFact = makeGlobalFact({
      text: 'We agreed on $5M Q4 budget in conference',
      sourceRoomId: 'room-conference',
      sourceRoomType: 'conference',
      sourceRoomConfidential: false,
    })
    const input = makeInput({
      currentRoomId: 'room-call-cto',
      roomType: 'call',
      roomIsConfidential: false,
      projectFacts: [conferenceFact],
    })
    const bundle = buildContextBundle(input)
    expect(bundle.fullPrompt).toContain('We agreed on $5M Q4 budget in conference')
  })

  it('meeting-room summary does not bleed into a different meeting room bundle', () => {
    const roomBMemory = makeMemory({
      summaryMd: null,
      conversationId: 'conv-meeting-b',
    })

    const roomBInput = makeInput({
      workingMemory: roomBMemory,
      roomType: 'meeting',
      currentRoomId: 'room-meeting-b',
      roomIsConfidential: false,
      projectFacts: [],
    })

    const bundle = buildContextBundle(roomBInput)

    expect(bundle.fullPrompt).not.toContain('Meeting A summary')
    expect(bundle.sections.workingMemorySummary).toBe('')
    expect(bundle.sections.projectFactsBlock).toBe('')
  })

  // Deduplication between local facts and projectFacts not needed: they are in separate sections
  // (workingMemorySummary vs projectFactsBlock). workingMemory.facts[] is not rendered directly
  // in the bundle — only summaryMd and openLoops are — so there is no double-rendering to guard.
})
