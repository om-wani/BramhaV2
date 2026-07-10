/**
 * Interrupts & summons engine tests — T3.3.4.
 *
 * All I/O is dependency-injected and mocked.
 * No Redis, Postgres, or BullMQ connections are opened.
 *
 * Scenarios:
 *   1.  Stop single agent: Redis key set, queue drained, agent.interrupted emitted
 *   2.  Stop all (personaId undefined): wildcard key set, all pending jobs drained
 *   3.  Redirect: stop-all + branch archived + new branch created + fork event
 *   4.  Summon authorized (csuite agent): job enqueued with forceSummon=true, event emitted
 *   5.  Summon unauthorized (non-member agent): rejected, interrupt.rejected emitted
 *   6.  checkInterjectThreshold — agent above INTERJECT_DELTA returned as interjector
 *   7.  checkInterjectThreshold — call room type → always returns []
 *   8.  checkInterrupt — key exists → { interrupted: true }
 *   9.  checkInterrupt — key absent → { interrupted: false }
 *  10.  Audit log emitted for all interrupt types
 */

import { describe, it, expect, vi, type Mock } from 'vitest'
import {
  handleInterrupt,
  checkInterrupt,
  checkInterjectThreshold,
  InterruptedError,
  INTERJECT_DELTA,
  INTERRUPT_TTL_SEC,
} from './interrupts.js'
import type { InterruptEvent, InterruptDeps } from './interrupts.js'
import type { AgentScore } from '../pa/relevance.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const PROJECT_ID = 'a0000001-0000-4000-8000-000000000001'
const CONV_ID    = 'a0000002-0000-4000-8000-000000000002'
const BRANCH_ID  = 'a0000005-0000-4000-8000-000000000005'
const PERSONA_A  = 'a1000001-0000-4000-8000-000000000011'
const PERSONA_B  = 'b1000002-0000-4000-8000-000000000012'
const USER_ID    = 'c1000003-0000-4000-8000-000000000013'
const NODE_ID    = 'd1000004-0000-4000-8000-000000000014'
const ROOM_ID    = 'e1000005-0000-4000-8000-000000000015'
const NEW_BRANCH = 'f1000006-0000-4000-8000-000000000016'

// ── Mock factory helpers ───────────────────────────────────────────────────────

function makeRedis(existsResult = 0) {
  return {
    exists: vi.fn().mockResolvedValue(existsResult),
    set: vi.fn().mockResolvedValue('OK'),
  } as unknown as InterruptDeps['redis']
}

function makeDeps(overrides?: Partial<InterruptDeps>): InterruptDeps {
  return {
    redis: makeRedis(),
    agentTurnsQueue: {
      add: vi.fn().mockResolvedValue(undefined),
      drain: vi.fn().mockResolvedValue(undefined),
    },
    publishEvent: vi.fn().mockResolvedValue(undefined),
    checkProjectMember: vi.fn().mockResolvedValue(true),
    checkRoomMembership: vi.fn().mockResolvedValue(true),
    archiveBranch: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue({
      id: NEW_BRANCH,
      name: 'redirect-fork',
      headNodeId: NODE_ID,
      createdAt: new Date().toISOString(),
    }),
    getConversationHeadNode: vi.fn().mockResolvedValue({
      nodeId: NODE_ID,
      roomId: ROOM_ID,
      branchId: BRANCH_ID,
    }),
    auditLog: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function stopEvent(personaId?: string): InterruptEvent {
  const base: InterruptEvent = {
    reason: 'stop',
    conversationId: CONV_ID,
    projectId: PROJECT_ID,
    raisedBy: { kind: 'user', id: USER_ID },
  }
  // exactOptionalPropertyTypes: include personaId only when provided
  return personaId !== undefined ? { ...base, personaId } : base
}

function redirectEvent(): InterruptEvent {
  return {
    reason: 'redirect',
    conversationId: CONV_ID,
    projectId: PROJECT_ID,
    raisedBy: { kind: 'user', id: USER_ID },
    branchId: BRANCH_ID,
  }
}

function summonEvent(raisedBy: { kind: 'user' | 'agent'; id: string }): InterruptEvent {
  return {
    reason: 'summon',
    conversationId: CONV_ID,
    projectId: PROJECT_ID,
    raisedBy,
    personaId: PERSONA_B,
  }
}

function makeAgentScore(personaId: string, score: number): AgentScore {
  return {
    agent: {
      personaId,
      slug: personaId.slice(0, 4),
      name: personaId.slice(0, 4),
      expertiseTags: [],
      expertiseCentroid: [],
      speakProfile: { eagerness: 0, interruptThreshold: 1.4, silenceBias: 0 },
    },
    score,
    breakdown: {
      mention: 0,
      expertise: 0,
      lexical: 0,
      threadOwnership: 0,
      openLoop: 0,
      recencyFatigue: 0,
      eagerness: 0,
      jitter: 0,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 — Stop single agent
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 1 — stop single agent', () => {
  it('sets per-agent Redis key with correct TTL', async () => {
    const deps = makeDeps()
    await handleInterrupt(stopEvent(PERSONA_A), deps)

    expect(deps.redis.set).toHaveBeenCalledWith(
      `interrupt:stop:${CONV_ID}:${PERSONA_A}`,
      '1',
      'EX',
      INTERRUPT_TTL_SEC,
    )
  })

  it('drains the agent-turns queue', async () => {
    const deps = makeDeps()
    await handleInterrupt(stopEvent(PERSONA_A), deps)
    expect(deps.agentTurnsQueue.drain).toHaveBeenCalledOnce()
  })

  it('emits agent.interrupted event with personaId', async () => {
    const deps = makeDeps()
    await handleInterrupt(stopEvent(PERSONA_A), deps)

    const publish = deps.publishEvent as Mock
    const call = publish.mock.calls.find(
      (args) => args[0] === `agent.interrupted:${PROJECT_ID}`,
    )
    expect(call).toBeDefined()
    const payload = call?.[1] as Record<string, unknown>
    expect(payload['personaId']).toBe(PERSONA_A)
    expect(payload['conversationId']).toBe(CONV_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 — Stop all (personaId undefined)
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 2 — stop all (no personaId)', () => {
  it('sets wildcard Redis key for stop-all', async () => {
    const deps = makeDeps()
    await handleInterrupt(stopEvent(undefined), deps)

    expect(deps.redis.set).toHaveBeenCalledWith(
      `interrupt:stop:${CONV_ID}:*`,
      '1',
      'EX',
      INTERRUPT_TTL_SEC,
    )
  })

  it('drains the queue for stop-all', async () => {
    const deps = makeDeps()
    await handleInterrupt(stopEvent(undefined), deps)
    expect(deps.agentTurnsQueue.drain).toHaveBeenCalledOnce()
  })

  it('emits agent.interrupted with null personaId', async () => {
    const deps = makeDeps()
    await handleInterrupt(stopEvent(undefined), deps)

    const publish = deps.publishEvent as Mock
    const call = publish.mock.calls.find(
      (args) => args[0] === `agent.interrupted:${PROJECT_ID}`,
    )
    expect(call).toBeDefined()
    const payload = call?.[1] as Record<string, unknown>
    expect(payload['personaId']).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3 — Redirect
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 3 — redirect interrupt', () => {
  it('performs stop-all (sets wildcard key + drains queue)', async () => {
    const deps = makeDeps()
    await handleInterrupt(redirectEvent(), deps)

    // Stop-all: wildcard key
    expect(deps.redis.set).toHaveBeenCalledWith(
      `interrupt:stop:${CONV_ID}:*`,
      '1',
      'EX',
      INTERRUPT_TTL_SEC,
    )
    expect(deps.agentTurnsQueue.drain).toHaveBeenCalledOnce()
  })

  it('archives the current branch', async () => {
    const deps = makeDeps()
    await handleInterrupt(redirectEvent(), deps)
    expect(deps.archiveBranch).toHaveBeenCalledWith(BRANCH_ID, PROJECT_ID)
  })

  it('creates a new branch forked from the conversation head node', async () => {
    const deps = makeDeps()
    await handleInterrupt(redirectEvent(), deps)

    const createBranch = deps.createBranch as Mock
    expect(createBranch).toHaveBeenCalledOnce()
    const [params] = createBranch.mock.calls[0] as [Parameters<InterruptDeps['createBranch']>[0]]
    expect(params.conversationId).toBe(CONV_ID)
    expect(params.projectId).toBe(PROJECT_ID)
    expect(params.forkedFromNodeId).toBe(NODE_ID)
    expect(params.createdByKind).toBe('user')
    expect(params.createdById).toBe(USER_ID)
  })

  it('emits conv.branch.forked with the new branch data', async () => {
    const deps = makeDeps()
    await handleInterrupt(redirectEvent(), deps)

    const publish = deps.publishEvent as Mock
    const call = publish.mock.calls.find(
      (args) => args[0] === `conv.branch.forked:${PROJECT_ID}`,
    )
    expect(call).toBeDefined()
    const payload = call?.[1] as Record<string, unknown>
    const branch = payload['branch'] as Record<string, unknown>
    expect(branch['id']).toBe(NEW_BRANCH)
    expect(branch['status']).toBe('active')
    expect(branch['forkedFromNode']).toBe(NODE_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4 — Summon authorized (csuite agent in room)
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 4 — summon authorized (csuite agent)', () => {
  it('enqueues agent-turn job with forceSummon=true', async () => {
    const deps = makeDeps({
      checkRoomMembership: vi.fn().mockResolvedValue(true),
    })

    await handleInterrupt(summonEvent({ kind: 'agent', id: PERSONA_A }), deps)

    const add = deps.agentTurnsQueue.add as Mock
    expect(add).toHaveBeenCalledOnce()
    const [name, jobData] = add.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('agent-turn')
    expect(jobData['forceSummon']).toBe(true)
    expect(jobData['personaId']).toBe(PERSONA_B)
    expect(jobData['triggerReason']).toBe('mention')
  })

  it('emits agent.summoned event', async () => {
    const deps = makeDeps({
      checkRoomMembership: vi.fn().mockResolvedValue(true),
    })

    await handleInterrupt(summonEvent({ kind: 'agent', id: PERSONA_A }), deps)

    const publish = deps.publishEvent as Mock
    const call = publish.mock.calls.find(
      (args) => args[0] === `agent.summoned:${PROJECT_ID}`,
    )
    expect(call).toBeDefined()
    const payload = call?.[1] as Record<string, unknown>
    expect(payload['personaId']).toBe(PERSONA_B)
  })

  it('does NOT call drain for summon', async () => {
    const deps = makeDeps({
      checkRoomMembership: vi.fn().mockResolvedValue(true),
    })

    await handleInterrupt(summonEvent({ kind: 'agent', id: PERSONA_A }), deps)
    expect(deps.agentTurnsQueue.drain).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5 — Summon unauthorized (non-member agent)
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 5 — summon unauthorized (non-member agent)', () => {
  it('does not enqueue any job', async () => {
    const deps = makeDeps({
      checkRoomMembership: vi.fn().mockResolvedValue(false),
    })

    await handleInterrupt(summonEvent({ kind: 'agent', id: PERSONA_A }), deps)
    expect(deps.agentTurnsQueue.add).not.toHaveBeenCalled()
  })

  it('emits interrupt.rejected event', async () => {
    const deps = makeDeps({
      checkRoomMembership: vi.fn().mockResolvedValue(false),
    })

    await handleInterrupt(summonEvent({ kind: 'agent', id: PERSONA_A }), deps)

    const publish = deps.publishEvent as Mock
    const call = publish.mock.calls.find(
      (args) => args[0] === `interrupt.rejected:${PROJECT_ID}`,
    )
    expect(call).toBeDefined()
    const payload = call?.[1] as Record<string, unknown>
    expect(payload['interruptReason']).toBe('summon')
    expect(payload['rejectionReason']).toBe('unauthorized')
  })

  it('does not emit agent.summoned for unauthorized summons', async () => {
    const deps = makeDeps({
      checkRoomMembership: vi.fn().mockResolvedValue(false),
    })

    await handleInterrupt(summonEvent({ kind: 'agent', id: PERSONA_A }), deps)

    const publish = deps.publishEvent as Mock
    const summonedCall = publish.mock.calls.find(
      (args) => args[0] === `agent.summoned:${PROJECT_ID}`,
    )
    expect(summonedCall).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6 — checkInterjectThreshold: agents above INTERJECT_DELTA interject
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 6 — checkInterjectThreshold: above delta → interject', () => {
  it('returns personaId of agent scoring above lowestSpeaker + INTERJECT_DELTA', () => {
    const speakers = [makeAgentScore(PERSONA_A, 1.0)]     // lowest speaker = 1.0
    const allScores = [
      makeAgentScore(PERSONA_A, 1.0),                     // current speaker
      makeAgentScore(PERSONA_B, 1.0 + INTERJECT_DELTA + 0.1), // above threshold
    ]

    const interjectors = checkInterjectThreshold(allScores, speakers, 'conference')
    expect(interjectors).toContain(PERSONA_B)
    expect(interjectors).not.toContain(PERSONA_A)
  })

  it('does not include agent scoring exactly at delta boundary (strict >)', () => {
    const speakers = [makeAgentScore(PERSONA_A, 1.0)]
    const allScores = [
      makeAgentScore(PERSONA_A, 1.0),
      makeAgentScore(PERSONA_B, 1.0 + INTERJECT_DELTA), // exactly at boundary
    ]

    const interjectors = checkInterjectThreshold(allScores, speakers, 'meeting')
    expect(interjectors).not.toContain(PERSONA_B)
  })

  it('returns [] when no agent is above the threshold', () => {
    const speakers = [makeAgentScore(PERSONA_A, 2.0)]
    const allScores = [
      makeAgentScore(PERSONA_A, 2.0),
      makeAgentScore(PERSONA_B, 2.0),  // same as speaker — not above delta
    ]

    const interjectors = checkInterjectThreshold(allScores, speakers, 'conference')
    expect(interjectors).toHaveLength(0)
  })

  it('returns [] when currentSpeakers is empty', () => {
    const allScores = [makeAgentScore(PERSONA_A, 5.0)]
    const interjectors = checkInterjectThreshold(allScores, [], 'meeting')
    expect(interjectors).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7 — checkInterjectThreshold: call room → always []
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 7 — checkInterjectThreshold: call room returns []', () => {
  it('always returns [] for call rooms regardless of scores', () => {
    const speakers = [makeAgentScore(PERSONA_A, 1.0)]
    const allScores = [
      makeAgentScore(PERSONA_A, 1.0),
      makeAgentScore(PERSONA_B, 100.0), // extremely high score
    ]

    const interjectors = checkInterjectThreshold(allScores, speakers, 'call')
    expect(interjectors).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 8 — checkInterrupt: key exists → { interrupted: true }
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 8 — checkInterrupt: key exists → interrupted', () => {
  it('returns { interrupted: true } when per-agent key exists', async () => {
    const redis = makeRedis(1) // exists() → 1
    const result = await checkInterrupt(CONV_ID, PERSONA_A, redis)
    expect(result.interrupted).toBe(true)
  })

  it('checks both specific and wildcard keys', async () => {
    const redis = {
      exists: vi.fn()
        .mockResolvedValueOnce(0) // specific key absent
        .mockResolvedValueOnce(1), // wildcard key present
    } as unknown as InterruptDeps['redis']

    const result = await checkInterrupt(CONV_ID, PERSONA_A, redis)
    expect(result.interrupted).toBe(true)
    expect(redis.exists).toHaveBeenCalledTimes(2)
    expect(redis.exists).toHaveBeenCalledWith(`interrupt:stop:${CONV_ID}:${PERSONA_A}`)
    expect(redis.exists).toHaveBeenCalledWith(`interrupt:stop:${CONV_ID}:*`)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 9 — checkInterrupt: key absent → { interrupted: false }
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 9 — checkInterrupt: key absent → not interrupted', () => {
  it('returns { interrupted: false } when both keys are absent', async () => {
    const redis = makeRedis(0) // exists() → 0
    const result = await checkInterrupt(CONV_ID, PERSONA_A, redis)
    expect(result.interrupted).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 10 — Audit log emitted for all interrupt types
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 10 — audit log emitted for all interrupt types', () => {
  it('calls auditLog for stop interrupt', async () => {
    const deps = makeDeps()
    await handleInterrupt(stopEvent(PERSONA_A), deps)

    const auditLog = deps.auditLog as Mock
    expect(auditLog).toHaveBeenCalledOnce()
    const [entry] = auditLog.mock.calls[0] as [Parameters<InterruptDeps['auditLog']>[0]]
    expect(entry.action).toBe('interrupt.stop')
    expect(entry.projectId).toBe(PROJECT_ID)
    expect(entry.actorKind).toBe('user')
    expect(entry.actorId).toBe(USER_ID)
  })

  it('calls auditLog for redirect interrupt', async () => {
    const deps = makeDeps()
    await handleInterrupt(redirectEvent(), deps)

    const auditLog = deps.auditLog as Mock
    expect(auditLog).toHaveBeenCalledOnce()
    const [entry] = auditLog.mock.calls[0] as [Parameters<InterruptDeps['auditLog']>[0]]
    expect(entry.action).toBe('interrupt.redirect')
  })

  it('calls auditLog for authorized summon', async () => {
    const deps = makeDeps({
      checkRoomMembership: vi.fn().mockResolvedValue(true),
    })
    await handleInterrupt(summonEvent({ kind: 'agent', id: PERSONA_A }), deps)

    const auditLog = deps.auditLog as Mock
    expect(auditLog).toHaveBeenCalledOnce()
    const [entry] = auditLog.mock.calls[0] as [Parameters<InterruptDeps['auditLog']>[0]]
    expect(entry.action).toBe('interrupt.summon')
  })

  it('does NOT call auditLog for unauthorized interrupt', async () => {
    const deps = makeDeps({
      checkRoomMembership: vi.fn().mockResolvedValue(false),
    })
    await handleInterrupt(summonEvent({ kind: 'agent', id: PERSONA_A }), deps)

    expect(deps.auditLog).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// InterruptedError class
// ─────────────────────────────────────────────────────────────────────────────

describe('InterruptedError', () => {
  it('has name InterruptedError and exposes conversationId / personaId', () => {
    const err = new InterruptedError(CONV_ID, PERSONA_A)
    expect(err.name).toBe('InterruptedError')
    expect(err.conversationId).toBe(CONV_ID)
    expect(err.personaId).toBe(PERSONA_A)
    expect(err.message).toContain(CONV_ID)
    expect(err.message).toContain(PERSONA_A)
    expect(err instanceof Error).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Authorization edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Authorization edge cases', () => {
  it('rejects stop raised by an agent (not user)', async () => {
    const deps = makeDeps()
    const event: InterruptEvent = {
      reason: 'stop',
      conversationId: CONV_ID,
      projectId: PROJECT_ID,
      raisedBy: { kind: 'agent', id: PERSONA_A }, // agent raising stop is unauthorized
    }

    await handleInterrupt(event, deps)

    expect(deps.agentTurnsQueue.drain).not.toHaveBeenCalled()
    const publish = deps.publishEvent as Mock
    const rejectedCall = publish.mock.calls.find(
      (args) => args[0] === `interrupt.rejected:${PROJECT_ID}`,
    )
    expect(rejectedCall).toBeDefined()
  })

  it('rejects stop when user is not a project member', async () => {
    const deps = makeDeps({
      checkProjectMember: vi.fn().mockResolvedValue(false),
    })

    await handleInterrupt(stopEvent(PERSONA_A), deps)

    expect(deps.agentTurnsQueue.drain).not.toHaveBeenCalled()
    const publish = deps.publishEvent as Mock
    const rejectedCall = publish.mock.calls.find(
      (args) => args[0] === `interrupt.rejected:${PROJECT_ID}`,
    )
    expect(rejectedCall).toBeDefined()
  })

  it('allows user to summon an agent (project member)', async () => {
    const deps = makeDeps({
      checkProjectMember: vi.fn().mockResolvedValue(true),
    })

    await handleInterrupt(summonEvent({ kind: 'user', id: USER_ID }), deps)

    expect(deps.agentTurnsQueue.add).toHaveBeenCalledOnce()
  })
})
