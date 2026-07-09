import { describe, it, expect } from 'vitest'
import {
  extractFacts,
  detectOpenLoops,
  closeLoops,
  updateWorkingMemory,
} from './working-memory.js'
import type { Fact, OpenLoop, WorkingMemory } from './working-memory.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeFact(text: string, sourceNode: string): Fact {
  return { text, sourceNode, confidence: 0.7, ts: new Date().toISOString() }
}

function makeLoop(id: string, text = 'What is the plan?'): OpenLoop {
  return { id, text, createdAt: new Date().toISOString() }
}

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

// ── extractFacts ───────────────────────────────────────────────────────────────

describe('extractFacts', () => {
  it('detects decision pattern (we will …)', () => {
    const facts = extractFacts(
      'We will launch next week to production.',
      'node-1',
      'Vulcan',
      'CTO',
    )
    expect(facts.length).toBeGreaterThan(0)
    const matched = facts.find((f) => /we will/i.test(f.text))
    expect(matched).toBeDefined()
    expect(matched!.sourceNode).toBe('node-1')
    expect(matched!.confidence).toBe(0.7)
  })

  it('detects number/date pattern (by 2024-03-15)', () => {
    const facts = extractFacts(
      'The deadline is by 2024-03-15 for the submission.',
      'node-2',
      'Ledger',
      'CFO',
    )
    expect(facts.some((f) => f.text.includes('2024-03-15'))).toBe(true)
  })

  it('detects commitment pattern with agent name', () => {
    const facts = extractFacts(
      'Vulcan will review the architecture next sprint.',
      'node-3',
      'Vulcan',
      'CTO',
    )
    expect(facts.some((f) => /vulcan/i.test(f.text))).toBe(true)
  })

  it('caps at MAX_FACTS_PER_NODE (3) even when multiple patterns match', () => {
    // This sentence matches decision + date + money + commitment
    const facts = extractFacts(
      'We will ship by 2024-05-01 and spend $50K; Vulcan will lead.',
      'node-4',
      'Vulcan',
      'CTO',
    )
    expect(facts.length).toBeLessThanOrEqual(3)
  })
})

// ── detectOpenLoops ────────────────────────────────────────────────────────────

describe('detectOpenLoops', () => {
  it('@slug + question mark → open loop', () => {
    const loops = detectOpenLoops(
      'Hey @cto what do you think about this architecture?',
      'node-5',
      'cto',
      'council',
    )
    expect(loops.length).toBe(1)
    expect(loops[0]!.id).toBeTruthy()
  })

  it('@slug without question marker → no loop', () => {
    const loops = detectOpenLoops(
      'Hey @cto here is some background information for you.',
      'node-6',
      'cto',
      'council',
    )
    expect(loops.length).toBe(0)
  })

  it('call room → any message is an open loop', () => {
    const loops = detectOpenLoops(
      'Please review this document for me.',
      'node-7',
      'cto',
      'call',
    )
    expect(loops.length).toBe(1)
  })

  it('mention with "can you" (no ?) → open loop', () => {
    const loops = detectOpenLoops(
      '@cfo can you review the budget proposal',
      'node-8',
      'cfo',
      'council',
    )
    expect(loops.length).toBe(1)
  })

  it('no @slug mention in non-call room → no loop', () => {
    const loops = detectOpenLoops(
      'What do you think about the marketing strategy?',
      'node-9',
      'cmo',
      'council',
    )
    expect(loops.length).toBe(0)
  })
})

// ── closeLoops ─────────────────────────────────────────────────────────────────

describe('closeLoops', () => {
  it('reply with overlapping words closes matching loop', () => {
    const loop = makeLoop('loop-1', 'What is the deployment plan for the release?')
    const closedIds = closeLoops(
      'The deployment plan for the release involves three phases. We start next week.',
      [loop],
    )
    expect(closedIds).toContain('loop-1')
  })

  it('dissimilar reply leaves loop open', () => {
    const loop = makeLoop('loop-1', 'What is the marketing strategy?')
    const closedIds = closeLoops(
      'The database indexes need optimization for better performance.',
      [loop],
    )
    expect(closedIds).not.toContain('loop-1')
  })

  it('skips already-closed loops', () => {
    const loop: OpenLoop = {
      id: 'loop-2',
      text: 'What is the plan for deployment?',
      createdAt: new Date().toISOString(),
      closedAt: new Date().toISOString(),
    }
    const closedIds = closeLoops(
      'The deployment plan is ready for review.',
      [loop],
    )
    expect(closedIds).not.toContain('loop-2')
  })

  it('returns empty array when no loops close', () => {
    const closedIds = closeLoops('Anything goes here.', [])
    expect(closedIds).toHaveLength(0)
  })
})

// ── updateWorkingMemory ────────────────────────────────────────────────────────

describe('updateWorkingMemory', () => {
  it('caps facts at 50 — LRU evicts oldest', () => {
    const existingFacts = Array.from({ length: 50 }, (_, i) =>
      makeFact(`existing fact ${i}`, `node-${i}`),
    )
    const mem = makeMemory({ facts: existingFacts })
    const newFact = makeFact('brand new fact', 'node-new')

    const updated = updateWorkingMemory(mem, [newFact], [], [])

    expect(updated.facts.length).toBe(50)
    // Newest fact must be present
    expect(updated.facts.some((f) => f.text === 'brand new fact')).toBe(true)
    // Oldest fact (index 0) must be evicted
    expect(updated.facts.some((f) => f.text === 'existing fact 0')).toBe(false)
  })

  it('caps open loops at 20 — drops oldest to make room', () => {
    const existingLoops = Array.from({ length: 20 }, (_, i) =>
      makeLoop(`loop-${i}`, `question ${i}`),
    )
    const mem = makeMemory({ openLoops: existingLoops })
    const newLoop = makeLoop('loop-new', 'brand new question')

    const updated = updateWorkingMemory(mem, [], [newLoop], [])

    expect(updated.openLoops.length).toBe(20)
    // New loop is present (it's newest)
    expect(updated.openLoops.some((l) => l.id === 'loop-new')).toBe(true)
    // Oldest loop (loop-0) evicted
    expect(updated.openLoops.some((l) => l.id === 'loop-0')).toBe(false)
  })

  it('marks closed loops with closedAt', () => {
    const loop = makeLoop('loop-close-me')
    const mem = makeMemory({ openLoops: [loop] })

    const updated = updateWorkingMemory(mem, [], [], ['loop-close-me'])

    const found = updated.openLoops.find((l) => l.id === 'loop-close-me')
    expect(found).toBeDefined()
    expect(found!.closedAt).toBeDefined()
  })

  it('refreshes updatedAt on every write', () => {
    const before = new Date(Date.now() - 1000).toISOString()
    const mem = makeMemory({ updatedAt: before })

    const updated = updateWorkingMemory(mem, [], [], [])

    expect(updated.updatedAt > before).toBe(true)
  })

  it('is immutable — does not mutate the input memory', () => {
    const mem = makeMemory()
    const original = JSON.stringify(mem)

    updateWorkingMemory(mem, [makeFact('new', 'n1')], [], [])

    expect(JSON.stringify(mem)).toBe(original)
  })
})
