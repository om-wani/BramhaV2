/**
 * Unit tests for ProactiveScheduler — all I/O mocked.
 */

import { describe, it, expect, vi, type Mock } from 'vitest'
import { ProactiveScheduler, type ProactiveSchedulerDeps, type ActiveConversation } from './proactive-scheduler.js'
import type { WorkingMemory } from './working-memory.js'
import type { AgentTurnJobData } from '../orchestrator/turn-engine.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROJECT_ID  = 'a0000001-0000-4000-8000-000000000001'
const CONV_ID     = 'a0000002-0000-4000-8000-000000000002'
const ROOM_ID     = 'a0000003-0000-4000-8000-000000000003'
const PERSONA_ID  = 'a0000004-0000-4000-8000-000000000004'
const BRANCH_ID   = 'a0000005-0000-4000-8000-000000000005'
const NODE_ID     = 'a0000006-0000-4000-8000-000000000006'

const NOW_MS = new Date('2026-01-15T12:00:00Z').getTime()

function makeMemory(openLoops: WorkingMemory['openLoops'] = []): WorkingMemory {
  return {
    personaId: PERSONA_ID,
    conversationId: CONV_ID,
    projectId: PROJECT_ID,
    facts: [],
    openLoops,
    lastSummaryNode: null,
    summaryMd: null,
    updatedAt: new Date().toISOString(),
  }
}

function makeLoop(minutesAgo: number, closedAt?: string): WorkingMemory['openLoops'][0] {
  return {
    id: `loop-${minutesAgo}`,
    text: 'unanswered question',
    createdAt: new Date(NOW_MS - minutesAgo * 60 * 1_000).toISOString(),
    ...(closedAt !== undefined ? { closedAt } : {}),
  }
}

function makeConvo(overrides: Partial<ActiveConversation> = {}): ActiveConversation {
  return {
    conversationId: CONV_ID,
    roomId: ROOM_ID,
    roomType: 'call',
    roomArchivedAt: null,
    personaMemories: [{ personaId: PERSONA_ID, memory: makeMemory([makeLoop(11)]) }],
    ...overrides,
  }
}

/**
 * Build a mock Redis for the atomic SET NX EX claim.
 * setResult='OK' → slot claimed (allowed); null → already claimed (denied).
 */
function mockRedis(setResult: string | null = 'OK') {
  return {
    set: vi.fn().mockResolvedValue(setResult),
  } as unknown as ProactiveSchedulerDeps['redis']
}

function makeDeps(overrides: Partial<ProactiveSchedulerDeps> = {}): ProactiveSchedulerDeps {
  return {
    redis: mockRedis(),
    loadActiveConversations: vi.fn().mockResolvedValue([makeConvo()]),
    isProactivityEnabled: vi.fn().mockResolvedValue(true),
    enqueueTurn: vi.fn().mockResolvedValue(undefined),
    getDefaultBranchId: vi.fn().mockResolvedValue(BRANCH_ID),
    getLastNodeId: vi.fn().mockResolvedValue(NODE_ID),
    // null = no recent activity = room is idle
    getLastRoomActivityMs: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProactiveScheduler.checkProject', () => {
  // ── Feature gate ──────────────────────────────────────────────────────────

  it('returns 0 and does not enqueue when proactivity is disabled', async () => {
    const deps = makeDeps({
      isProactivityEnabled: vi.fn().mockResolvedValue(false),
    })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(0)
    expect(deps.enqueueTurn as Mock).not.toHaveBeenCalled()
  })

  // ── Archived rooms ────────────────────────────────────────────────────────

  it('skips archived rooms', async () => {
    const deps = makeDeps({
      loadActiveConversations: vi.fn().mockResolvedValue([
        makeConvo({ roomArchivedAt: '2026-01-01T00:00:00Z' }),
      ]),
    })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(0)
    expect(deps.enqueueTurn as Mock).not.toHaveBeenCalled()
  })

  // ── Room type filter ──────────────────────────────────────────────────────

  it('skips conference rooms (spec: only call/meeting)', async () => {
    const deps = makeDeps({
      loadActiveConversations: vi.fn().mockResolvedValue([
        makeConvo({ roomType: 'conference' }),
      ]),
    })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(0)
  })

  it('skips office rooms', async () => {
    const deps = makeDeps({
      loadActiveConversations: vi.fn().mockResolvedValue([
        makeConvo({ roomType: 'office' }),
      ]),
    })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(0)
  })

  it('fires in call rooms', async () => {
    const deps = makeDeps({
      loadActiveConversations: vi.fn().mockResolvedValue([
        makeConvo({ roomType: 'call' }),
      ]),
    })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(1)
  })

  it('fires in meeting rooms', async () => {
    const deps = makeDeps({
      loadActiveConversations: vi.fn().mockResolvedValue([
        makeConvo({ roomType: 'meeting' }),
      ]),
    })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(1)
  })

  // ── Idle check ───────────────────────────────────────────────────────────

  it('skips when room has activity within the last 5 min (not idle)', async () => {
    // Activity 1 minute ago → room is NOT idle → scheduler must skip
    const activityOneMinAgo = NOW_MS - 60 * 1_000
    const deps = makeDeps({
      getLastRoomActivityMs: vi.fn().mockResolvedValue(activityOneMinAgo),
    })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(0)
    expect(deps.enqueueTurn as Mock).not.toHaveBeenCalled()
  })

  it('fires when room has been idle for >= 5 min', async () => {
    // Activity 6 minutes ago → room is idle → should fire
    const activitySixMinAgo = NOW_MS - 6 * 60 * 1_000
    const deps = makeDeps({
      getLastRoomActivityMs: vi.fn().mockResolvedValue(activitySixMinAgo),
    })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(1)
  })

  it('treats null lastActivityMs (no nodes) as idle', async () => {
    const deps = makeDeps({ getLastRoomActivityMs: vi.fn().mockResolvedValue(null) })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(1)
  })

  // ── Rate limit ────────────────────────────────────────────────────────────

  it('does not fire when rate-limited (Redis key set)', async () => {
    const deps = makeDeps({
      redis: mockRedis(null), // SET NX returns null → slot already claimed
    })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(0)
    expect(deps.enqueueTurn as Mock).not.toHaveBeenCalled()
  })

  it('claims rate-limit slot atomically (SET NX EX) after firing', async () => {
    const deps = makeDeps()
    const scheduler = new ProactiveScheduler(deps)
    await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect((deps.redis.set as Mock)).toHaveBeenCalledWith(
      `proactive:rate:${PERSONA_ID}:${ROOM_ID}`,
      1,
      'NX',
      'EX',
      3600,
    )
  })

  // ── Clock-advanced tests ──────────────────────────────────────────────────

  it('clock-advanced: 11 min old loop → enqueues follow-up', async () => {
    const deps = makeDeps({
      loadActiveConversations: vi.fn().mockResolvedValue([
        makeConvo({
          personaMemories: [{ personaId: PERSONA_ID, memory: makeMemory([makeLoop(11)]) }],
        }),
      ]),
    })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(1)
  })

  it('clock-advanced: 9 min old loop → does not enqueue', async () => {
    const deps = makeDeps({
      loadActiveConversations: vi.fn().mockResolvedValue([
        makeConvo({
          personaMemories: [{ personaId: PERSONA_ID, memory: makeMemory([makeLoop(9)]) }],
        }),
      ]),
    })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(0)
  })

  // ── Job shape ─────────────────────────────────────────────────────────────

  it('enqueues job with triggerReason follow-up and correct fields', async () => {
    const deps = makeDeps()
    const scheduler = new ProactiveScheduler(deps)
    await scheduler.checkProject(PROJECT_ID, NOW_MS)

    const enqueueMock = deps.enqueueTurn as Mock
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const job = enqueueMock.mock.calls[0]![0] as AgentTurnJobData
    expect(job.triggerReason).toBe('follow-up')
    expect(job.projectId).toBe(PROJECT_ID)
    expect(job.conversationId).toBe(CONV_ID)
    expect(job.branchId).toBe(BRANCH_ID)
    expect(job.triggerNodeId).toBe(NODE_ID)
    expect(job.personaId).toBe(PERSONA_ID)
    expect(job.turnDepth).toBe(0)
    expect(job.otherSpeakers).toEqual([])
  })

  // ── Edge: no branch / no node ─────────────────────────────────────────────

  it('skips when getDefaultBranchId returns null', async () => {
    const deps = makeDeps({ getDefaultBranchId: vi.fn().mockResolvedValue(null) })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(0)
  })

  it('skips when getLastNodeId returns null', async () => {
    const deps = makeDeps({ getLastNodeId: vi.fn().mockResolvedValue(null) })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(0)
  })

  // ── Empty working memory / closed loops ───────────────────────────────────

  it('does not fire when all open loops are closed', async () => {
    const closedAt = new Date(NOW_MS - 60_000).toISOString()
    const deps = makeDeps({
      loadActiveConversations: vi.fn().mockResolvedValue([
        makeConvo({
          personaMemories: [{
            personaId: PERSONA_ID,
            memory: makeMemory([makeLoop(11, closedAt)]),
          }],
        }),
      ]),
    })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(0)
  })

  it('returns 0 when there are no conversations', async () => {
    const deps = makeDeps({ loadActiveConversations: vi.fn().mockResolvedValue([]) })
    const scheduler = new ProactiveScheduler(deps)
    const count = await scheduler.checkProject(PROJECT_ID, NOW_MS)
    expect(count).toBe(0)
  })
})
