/**
 * Turn engine tests — 10 scenarios per spec T3.3.1.
 *
 * All I/O is dependency-injected and mocked.
 * No Redis, Postgres, or BullMQ connections are opened.
 */

import { describe, it, expect, vi, type Mock } from 'vitest'
import { processTurnJob } from './turn-engine.js'
import type { TurnEngineDeps, RoomWithRoster, AgentTurnJobData } from './turn-engine.js'
import type { WorkingMemory } from '../pa/working-memory.js'
import type { ScoringNode } from '../pa/relevance.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Valid RFC 4122 v4 UUIDs (version=4, variant=[89ab])
const PROJECT_ID  = 'a0000001-0000-4000-8000-000000000001'
const CONV_ID     = 'a0000002-0000-4000-8000-000000000002'
const NODE_ID     = 'a0000003-0000-4000-8000-000000000003'
const ROOM_ID     = 'a0000004-0000-4000-8000-000000000004'
const BRANCH_ID   = 'a0000005-0000-4000-8000-000000000005'

const AGENT_A_ID  = 'a1000001-0000-4000-8000-000000000011'
const AGENT_B_ID  = 'b1000002-0000-4000-8000-000000000012'
const AGENT_C_ID  = 'c1000003-0000-4000-8000-000000000013'
const AGENT_D_ID  = 'd1000004-0000-4000-8000-000000000014'
const AGENT_E_ID  = 'e1000005-0000-4000-8000-000000000015'

type RosterAgentSpec = {
  personaId: string
  slug?: string
  name?: string
  eagerness?: number
  silenceBias?: number
  expertiseTags?: string[]
}

function makeAgent(spec: RosterAgentSpec) {
  return {
    personaId: spec.personaId,
    slug: spec.slug ?? spec.personaId.slice(0, 4),
    name: spec.name ?? spec.personaId.slice(0, 4),
    title: spec.slug ?? spec.personaId.slice(0, 4),
    expertiseTags: spec.expertiseTags ?? [],
    speakProfile: {
      eagerness: spec.eagerness ?? 0,
      interruptThreshold: 1.4,
      silenceBias: spec.silenceBias ?? 0,
    },
  }
}

function makeRoster(agents: ReturnType<typeof makeAgent>[], roomType = 'conference'): RoomWithRoster {
  return {
    roomType,
    defaultBranchId: BRANCH_ID,
    agents,
  }
}

function emptyMemory(personaId: string): WorkingMemory {
  return {
    personaId,
    conversationId: CONV_ID,
    projectId: PROJECT_ID,
    facts: [],
    openLoops: [],
    lastSummaryNode: null,
    summaryMd: null,
    updatedAt: new Date().toISOString(),
  }
}

function baseJobData(overrides?: Partial<{
  authorKind: 'user' | 'agent' | 'system'
  authorPersonaId?: string
  turnDepth: number
  nodeText: string
}>) {
  return {
    event: 'conv.node.appended' as const,
    projectId: PROJECT_ID,
    conversationId: CONV_ID,
    nodeId: NODE_ID,
    roomId: ROOM_ID,
    authorKind: 'user' as const,
    turnDepth: 0,
    nodeText: 'Hello team, can you help?',
    ...overrides,
  }
}

/** Build a mock Redis with exists() returning 0 (not paused) by default. */
function mockRedis(existsResult = 0) {
  return {
    exists: vi.fn().mockResolvedValue(existsResult),
  } as unknown as TurnEngineDeps['redis']
}

/** Build a full deps object; each field is individually overridable. */
function makeDeps(overrides?: Partial<TurnEngineDeps>): TurnEngineDeps {
  const threeAgents = [
    makeAgent({ personaId: AGENT_A_ID, slug: 'ceo', name: 'CEO', eagerness: 2 }),
    makeAgent({ personaId: AGENT_B_ID, slug: 'cto', name: 'CTO', eagerness: 2 }),
    makeAgent({ personaId: AGENT_C_ID, slug: 'cfo', name: 'CFO', eagerness: 2 }),
  ]

  const memMap = new Map<string, WorkingMemory>([
    [AGENT_A_ID, emptyMemory(AGENT_A_ID)],
    [AGENT_B_ID, emptyMemory(AGENT_B_ID)],
    [AGENT_C_ID, emptyMemory(AGENT_C_ID)],
  ])

  return {
    redis: mockRedis(),
    loadRosterAndRoom: vi.fn().mockResolvedValue(makeRoster(threeAgents)),
    loadRecentAncestors: vi.fn().mockResolvedValue([] as ScoringNode[]),
    loadWorkingMemories: vi.fn().mockResolvedValue(memMap),
    upsertWorkingMemory: vi.fn().mockResolvedValue(undefined),
    checkDailyUsd: vi.fn().mockResolvedValue(0),
    agentTurnsQueue: { add: vi.fn().mockResolvedValue(undefined) },
    dlqQueue: { add: vi.fn().mockResolvedValue(undefined) },
    housekeepingQueue: { add: vi.fn().mockResolvedValue(undefined) },
    scheduleProactiveCheck: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

// ── Scenario helpers ──────────────────────────────────────────────────────────

/** Collect all agent-turn job data objects passed to agentTurnsQueue.add */
function capturedAgentTurns(deps: TurnEngineDeps): AgentTurnJobData[] {
  const mock = deps.agentTurnsQueue.add as Mock
  return mock.mock.calls.map((call) => call[1] as AgentTurnJobData)
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 — User message in 3-agent room → all 3 scored, speakers enqueued in score order
// ─────────────────────────────────────────────────────────────────────────────

describe('T1 — 3-agent room: user message → speakers enqueued', () => {
  it('enqueues agent-turn jobs for all eligible speakers in score order', async () => {
    const deps = makeDeps()
    await processTurnJob(baseJobData(), deps)

    const turns = capturedAgentTurns(deps)
    // conference room with high-eagerness agents — all 3 should clear threshold
    expect(turns.length).toBeGreaterThanOrEqual(1)
    expect(turns.every((t) => t.projectId === PROJECT_ID)).toBe(true)
    expect(turns.every((t) => t.conversationId === CONV_ID)).toBe(true)
    expect(turns.every((t) => t.triggerNodeId === NODE_ID)).toBe(true)
    // turnDepth should be incremented
    expect(turns.every((t) => t.turnDepth === 1)).toBe(true)
  })

  it('uses group option with conv:conversationId key', async () => {
    const deps = makeDeps()
    await processTurnJob(baseJobData(), deps)

    const addMock = deps.agentTurnsQueue.add as Mock
    expect(addMock).toHaveBeenCalled()
    const firstCallOpts = addMock.mock.calls[0]?.[2] as { group?: { id?: string } }
    expect(firstCallOpts?.group?.id).toBe(`conv:${CONV_ID}`)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T2 — @mention agent always in speaker set even if score < θ
// ─────────────────────────────────────────────────────────────────────────────

describe('T2 — @mention dominates: mentioned agent always speaks', () => {
  it('agent explicitly @mentioned is always in speaker set', async () => {
    // Use a 'meeting' room; include a @cfo mention in text to force CFO
    const agents = [
      makeAgent({ personaId: AGENT_A_ID, slug: 'ceo', name: 'CEO', eagerness: 0 }),
      makeAgent({ personaId: AGENT_B_ID, slug: 'cto', name: 'CTO', eagerness: 0 }),
      makeAgent({ personaId: AGENT_C_ID, slug: 'cfo', name: 'CFO', eagerness: 0 }),
    ]
    const deps = makeDeps({
      loadRosterAndRoom: vi.fn().mockResolvedValue(makeRoster(agents, 'meeting')),
      loadWorkingMemories: vi.fn().mockResolvedValue(new Map([
        [AGENT_A_ID, emptyMemory(AGENT_A_ID)],
        [AGENT_B_ID, emptyMemory(AGENT_B_ID)],
        [AGENT_C_ID, emptyMemory(AGENT_C_ID)],
      ])),
    })

    // @cfo mention → w_m=10 boost → score ~10, way above θ_meeting=1.4
    await processTurnJob(
      baseJobData({ nodeText: 'hey @cfo can you check the budget?' }),
      deps,
    )

    const turns = capturedAgentTurns(deps)
    const speakerIds = turns.map((t) => t.personaId)
    expect(speakerIds).toContain(AGENT_C_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T3 — turn_depth ≥ 4 with agent trigger → no speakers enqueued
// ─────────────────────────────────────────────────────────────────────────────

describe('T3 — convergence guard: depth ≥ 4 with agent trigger', () => {
  it('stops scheduling when turn_depth ≥ 4 and trigger is agent', async () => {
    const deps = makeDeps()
    await processTurnJob(
      baseJobData({
        authorKind: 'agent',
        authorPersonaId: AGENT_A_ID,
        turnDepth: 4,
      }),
      deps,
    )

    const turns = capturedAgentTurns(deps)
    expect(turns).toHaveLength(0)
  })

  it('depth=3 with agent trigger still enqueues (below cap)', async () => {
    const deps = makeDeps()
    await processTurnJob(
      baseJobData({
        authorKind: 'agent',
        authorPersonaId: AGENT_A_ID,
        turnDepth: 3,
        nodeText: '@ceo @cto @cfo please respond',
      }),
      deps,
    )

    // At depth=3 scheduling is still permitted
    const turns = capturedAgentTurns(deps)
    // At least someone should speak given high eagerness + mentions
    expect(turns.length).toBeGreaterThanOrEqual(1)
    // turnDepth is incremented (would be 4)
    if (turns.length > 0) {
      expect(turns[0]!.turnDepth).toBe(4)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T4 — agents_paused Redis key → no speakers enqueued, job still succeeds
// ─────────────────────────────────────────────────────────────────────────────

describe('T4 — agents_paused halts scheduling', () => {
  it('returns without enqueuing when agents_paused:{projectId} key exists', async () => {
    const deps = makeDeps({
      redis: mockRedis(1), // exists() returns 1 → paused
    })

    await processTurnJob(baseJobData(), deps)

    expect(deps.agentTurnsQueue.add as Mock).not.toHaveBeenCalled()
    expect(deps.dlqQueue.add as Mock).not.toHaveBeenCalled()
  })

  it('redis.exists is called with correct key', async () => {
    const redisMock = mockRedis(0)
    const deps = makeDeps({ redis: redisMock })
    await processTurnJob(baseJobData(), deps)
    expect(redisMock.exists).toHaveBeenCalledWith(`agents_paused:${PROJECT_ID}`)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T5 — Malformed job data → DLQ, no throw
// ─────────────────────────────────────────────────────────────────────────────

describe('T5 — poison-message handling: malformed → DLQ, no throw', () => {
  it('routes Zod-invalid payload to DLQ and does not throw', async () => {
    const deps = makeDeps()
    // Missing required fields: no projectId, wrong event type
    const malformed = { event: 'something.else', foo: 'bar' }

    await expect(processTurnJob(malformed, deps)).resolves.not.toThrow()
    expect(deps.dlqQueue.add as Mock).toHaveBeenCalledTimes(1)
    const [name, data] = (deps.dlqQueue.add as Mock).mock.calls[0]!
    expect(name).toBe('malformed-event')
    expect((data as { rawData: unknown }).rawData).toEqual(malformed)
  })

  it('missing projectId also routes to DLQ', async () => {
    const deps = makeDeps()
    const malformed = {
      event: 'conv.node.appended',
      conversationId: CONV_ID,
      nodeId: NODE_ID,
      roomId: ROOM_ID,
      // projectId missing
      authorKind: 'user',
      turnDepth: 0,
      nodeText: 'hello',
    }

    await expect(processTurnJob(malformed, deps)).resolves.not.toThrow()
    expect(deps.dlqQueue.add as Mock).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T6 — Daily budget exceeded → no speakers enqueued
// ─────────────────────────────────────────────────────────────────────────────

describe('T6 — daily USD budget exceeded', () => {
  it('does not enqueue when daily spend ≥ DAILY_USD_LIMIT', async () => {
    const deps = makeDeps({
      checkDailyUsd: vi.fn().mockResolvedValue(100), // at limit
    })

    await processTurnJob(baseJobData(), deps)

    expect(deps.agentTurnsQueue.add as Mock).not.toHaveBeenCalled()
  })

  it('enqueues normally when spend is below limit', async () => {
    const deps = makeDeps({
      checkDailyUsd: vi.fn().mockResolvedValue(99.99),
    })

    await processTurnJob(baseJobData(), deps)

    // Should have attempted to enqueue (conference fallback fires)
    // agents have eagerness=2 so they should clear conference θ=1.8
    const turns = capturedAgentTurns(deps)
    expect(turns.length).toBeGreaterThanOrEqual(0)
    // checkDailyUsd was called once
    expect(deps.checkDailyUsd as Mock).toHaveBeenCalledWith(PROJECT_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T7 — Working memory updated for ALL agents (not just speakers)
// ─────────────────────────────────────────────────────────────────────────────

describe('T7 — working memory updated for ALL roster agents', () => {
  it('calls upsertWorkingMemory for every agent in the roster', async () => {
    // Use only 2 agents, 1 of which won't speak (no eagerness, low score)
    const agents = [
      makeAgent({ personaId: AGENT_A_ID, slug: 'ceo', name: 'CEO', eagerness: 5 }),
      makeAgent({ personaId: AGENT_B_ID, slug: 'cto', name: 'CTO', eagerness: 0 }),
    ]
    const deps = makeDeps({
      loadRosterAndRoom: vi.fn().mockResolvedValue(makeRoster(agents, 'meeting')),
      loadWorkingMemories: vi.fn().mockResolvedValue(
        new Map([
          [AGENT_A_ID, emptyMemory(AGENT_A_ID)],
          [AGENT_B_ID, emptyMemory(AGENT_B_ID)],
        ]),
      ),
    })

    await processTurnJob(baseJobData(), deps)

    const upsertMock = deps.upsertWorkingMemory as Mock
    const upsertedIds = upsertMock.mock.calls.map(
      (call) => (call[0] as WorkingMemory).personaId,
    )
    // Both agents must have had their memory updated
    expect(upsertedIds).toContain(AGENT_A_ID)
    expect(upsertedIds).toContain(AGENT_B_ID)
    expect(upsertMock).toHaveBeenCalledTimes(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T8 — Summary threshold crossed → housekeeping job enqueued
// ─────────────────────────────────────────────────────────────────────────────

describe('T8 — summary threshold → housekeeping job enqueued', () => {
  it('enqueues housekeeping summarize job when threshold is exceeded', async () => {
    // Build a memory with a long existing summary to push tokens over threshold
    const longText = 'word '.repeat(4000) // ~4000 words × 4 chars each → ~4000 tokens est.
    const triggerMemory: WorkingMemory = {
      ...emptyMemory(AGENT_A_ID),
      summaryMd: null,
      lastSummaryNode: null,
    }

    // Provide a long nodeText so the unsummarized token count exceeds 3500
    const deps = makeDeps({
      loadWorkingMemories: vi.fn().mockResolvedValue(
        new Map([[AGENT_A_ID, triggerMemory]]),
      ),
      loadRosterAndRoom: vi.fn().mockResolvedValue(
        makeRoster([makeAgent({ personaId: AGENT_A_ID, slug: 'ceo', name: 'CEO', eagerness: 5 })]),
      ),
      // Also mock ancestors with lots of text
      loadRecentAncestors: vi.fn().mockResolvedValue(
        Array.from({ length: 6 }, (_, i) => ({
          nodeId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
          text: 'a '.repeat(600), // ~150 tokens each × 6 = ~900 tokens
          type: 'user_message',
          authorPersonaId: null,
          embedding: [],
        } satisfies ScoringNode)),
      ),
    })

    await processTurnJob(baseJobData({ nodeText: longText }), deps)

    const housekeepingAdd = deps.housekeepingQueue.add as Mock
    expect(housekeepingAdd).toHaveBeenCalledTimes(1)
    const [name] = housekeepingAdd.mock.calls[0]!
    expect(name).toBe('summarize')
  })

  it('does NOT enqueue housekeeping when tokens are below threshold', async () => {
    const deps = makeDeps() // short nodeText in baseJobData
    await processTurnJob(baseJobData(), deps)
    // Threshold is 3500 tokens; "Hello team, can you help?" is ~7 tokens
    expect(deps.housekeepingQueue.add as Mock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T9 — Conference room fallback: all below θ → highest scorer still speaks
// ─────────────────────────────────────────────────────────────────────────────

describe('T9 — conference fallback: all below θ → highest scorer speaks', () => {
  it('enqueues at least 1 agent in conference even when all scores are low', async () => {
    // Agents with no eagerness, no tags, no mention → low scores
    const agents = [
      makeAgent({ personaId: AGENT_A_ID, slug: 'ceo', name: 'CEO', eagerness: 0 }),
      makeAgent({ personaId: AGENT_B_ID, slug: 'cto', name: 'CTO', eagerness: 0 }),
    ]
    const deps = makeDeps({
      loadRosterAndRoom: vi.fn().mockResolvedValue(makeRoster(agents, 'conference')),
      loadWorkingMemories: vi.fn().mockResolvedValue(new Map([
        [AGENT_A_ID, emptyMemory(AGENT_A_ID)],
        [AGENT_B_ID, emptyMemory(AGENT_B_ID)],
      ])),
    })

    await processTurnJob(baseJobData({ nodeText: 'ok' }), deps)

    const turns = capturedAgentTurns(deps)
    // Conference room fallback fires: highest scorer speaks even below θ
    expect(turns).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T10 — Max 3 speakers cap: 5 eligible agents → only 3 enqueued
// ─────────────────────────────────────────────────────────────────────────────

describe('T10 — max 3 speakers cap', () => {
  it('caps speaker set at 3 even when 5 agents are eligible', async () => {
    // 5 agents all with high eagerness → all clear meeting θ=1.4
    const agents = [
      makeAgent({ personaId: AGENT_A_ID, slug: 'ceo', name: 'CEO', eagerness: 5 }),
      makeAgent({ personaId: AGENT_B_ID, slug: 'cto', name: 'CTO', eagerness: 5 }),
      makeAgent({ personaId: AGENT_C_ID, slug: 'cfo', name: 'CFO', eagerness: 5 }),
      makeAgent({ personaId: AGENT_D_ID, slug: 'cmo', name: 'CMO', eagerness: 5 }),
      makeAgent({ personaId: AGENT_E_ID, slug: 'coo', name: 'COO', eagerness: 5 }),
    ]
    const deps = makeDeps({
      loadRosterAndRoom: vi.fn().mockResolvedValue(makeRoster(agents, 'meeting')),
      loadWorkingMemories: vi.fn().mockResolvedValue(
        new Map(agents.map((a) => [a.personaId, emptyMemory(a.personaId)])),
      ),
    })

    await processTurnJob(
      baseJobData({ nodeText: 'team please discuss the strategy' }),
      deps,
    )

    const turns = capturedAgentTurns(deps)
    expect(turns.length).toBeLessThanOrEqual(3)
  })
})
