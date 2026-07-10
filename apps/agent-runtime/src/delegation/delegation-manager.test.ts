/**
 * DelegationManager unit tests.
 *
 * All external I/O is mocked via DelegationManagerDeps.
 * No Redis, Postgres, or BullMQ connections are opened.
 *
 * Tests:
 *   1. Authority check: CMO cannot spawn code-reviewer → AuthorityError
 *   2. Authority check: CMO CAN spawn researcher → succeeds, job enqueued
 *   3. Concurrent cap: 3 active delegations → ConcurrentCapError on 4th
 *   4. delegation.created event emitted on success
 *   5. Budget guard blocks if daily USD exceeded
 */

import { describe, it, expect, vi } from 'vitest'
import {
  spawnDelegation,
  AuthorityError,
  ConcurrentCapError,
} from './delegation-manager.js'
import type { DelegationManagerDeps, SpawnDelegationInput } from './delegation-manager.js'
import { DAILY_USD_LIMIT } from '../orchestrator/budget-guard.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROJECT_ID = 'a0000001-0000-4000-8000-000000000001'
const CONVERSATION_ID = 'a0000002-0000-4000-8000-000000000002'
const BRANCH_ID = 'a0000003-0000-4000-8000-000000000003'
const ORIGIN_NODE_ID = 'a0000004-0000-4000-8000-000000000004'
const CMO_PERSONA_ID = 'a1000001-0000-4000-8000-000000000011'

const baseInput: SpawnDelegationInput = {
  delegatingPersonaId: CMO_PERSONA_ID,
  workerSlug: 'researcher',
  objective: 'Research market trends for Q4',
  inputs: { market: 'B2B SaaS' },
  deliverable: 'Market analysis report',
  budget: { maxUsd: 5, maxSeconds: 300, maxToolCalls: 20 },
  originNodeId: ORIGIN_NODE_ID,
  conversationId: CONVERSATION_ID,
  projectId: PROJECT_ID,
  branchId: BRANCH_ID,
}

/** CMO authority: can delegate only to 'researcher' and 'analyst'. */
const CMO_AUTHORITY = {
  canDelegate: ['researcher', 'analyst'],
  perTaskBudgetUsd: 10,
}

// ── Mock factory ───────────────────────────────────────────────────────────────

function makeDeps(opts: {
  authority?: typeof CMO_AUTHORITY | null
  activeCount?: number
  dailyUsd?: number
  redisPaused?: boolean
}): DelegationManagerDeps {
  const {
    authority = CMO_AUTHORITY,
    activeCount = 0,
    dailyUsd = 0,
    redisPaused = false,
  } = opts

  return {
    redis: {
      exists: vi.fn().mockResolvedValue(redisPaused ? 1 : 0),
    } as unknown as DelegationManagerDeps['redis'],

    loadPersonaDelegationAuthority: vi.fn().mockResolvedValue(authority),
    countActiveDelegations: vi.fn().mockResolvedValue(activeCount),
    insertDelegation: vi.fn().mockResolvedValue(undefined),

    delegationsQueue: {
      add: vi.fn().mockResolvedValue({ id: 'bullmq-job-1' }),
    } as unknown as DelegationManagerDeps['delegationsQueue'],

    agentTurnsQueue: {
      add: vi.fn().mockResolvedValue({ id: 'bullmq-job-2' }),
    } as unknown as DelegationManagerDeps['agentTurnsQueue'],

    eventPublisher: {
      publish: vi.fn().mockResolvedValue(undefined),
    } as unknown as DelegationManagerDeps['eventPublisher'],

    checkDailyUsd: vi.fn().mockResolvedValue(dailyUsd),
  }
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('spawnDelegation', () => {
  it('1. throws AuthorityError when persona cannot delegate to workerSlug', async () => {
    const deps = makeDeps({ authority: CMO_AUTHORITY })

    await expect(
      spawnDelegation({ ...baseInput, workerSlug: 'code-reviewer' }, deps),
    ).rejects.toThrow(AuthorityError)

    // Should not enqueue or insert
    expect(deps.delegationsQueue.add).not.toHaveBeenCalled()
    expect(deps.insertDelegation).not.toHaveBeenCalled()
  })

  it('2. succeeds and enqueues job when persona can delegate to workerSlug', async () => {
    const deps = makeDeps({ authority: CMO_AUTHORITY, activeCount: 0 })

    const result = await spawnDelegation({ ...baseInput, workerSlug: 'researcher' }, deps)

    expect(result.delegationId).toBeDefined()
    expect(typeof result.delegationId).toBe('string')
    expect(result.delegationId.length).toBeGreaterThan(0)

    // Should insert delegation row
    expect(deps.insertDelegation).toHaveBeenCalledOnce()
    const insertCall = vi.mocked(deps.insertDelegation).mock.calls[0]![0]
    expect(insertCall.spec.workerSlug).toBe('researcher')
    expect(insertCall.spec.objective).toBe(baseInput.objective)
    expect(insertCall.parentPersonaId).toBe(CMO_PERSONA_ID)

    // Should enqueue BullMQ job
    expect(deps.delegationsQueue.add).toHaveBeenCalledOnce()
    const jobCall = vi.mocked(deps.delegationsQueue.add).mock.calls[0]
    expect(jobCall![0]).toBe('delegation')
    const jobData = jobCall![1] as Record<string, unknown>
    expect(jobData['delegationId']).toBe(result.delegationId)
    expect(jobData['workerSlug']).toBe('researcher')
    expect(jobData['projectId']).toBe(PROJECT_ID)
  })

  it('3. throws ConcurrentCapError when 3 active delegations already exist', async () => {
    const deps = makeDeps({ authority: CMO_AUTHORITY, activeCount: 3 })

    await expect(
      spawnDelegation({ ...baseInput, workerSlug: 'researcher' }, deps),
    ).rejects.toThrow(ConcurrentCapError)

    expect(deps.insertDelegation).not.toHaveBeenCalled()
    expect(deps.delegationsQueue.add).not.toHaveBeenCalled()
  })

  it('3b. allows delegation when 2 active delegations exist (below cap)', async () => {
    const deps = makeDeps({ authority: CMO_AUTHORITY, activeCount: 2 })

    const result = await spawnDelegation({ ...baseInput, workerSlug: 'researcher' }, deps)

    expect(result.delegationId).toBeDefined()
    expect(deps.delegationsQueue.add).toHaveBeenCalledOnce()
  })

  it('4. emits delegation.created event with correct payload on success', async () => {
    const deps = makeDeps({ authority: CMO_AUTHORITY, activeCount: 0 })

    const result = await spawnDelegation({ ...baseInput, workerSlug: 'researcher' }, deps)

    expect(deps.eventPublisher.publish).toHaveBeenCalledOnce()
    const [channel, payload] = vi.mocked(deps.eventPublisher.publish).mock.calls[0]!
    expect(channel).toBe(`delegation.created:${PROJECT_ID}`)
    expect(payload).toMatchObject({
      delegationId: result.delegationId,
      projectId: PROJECT_ID,
      workerSlug: 'researcher',
    })
  })

  it('5. throws when daily USD budget is exceeded (daily_budget_exceeded)', async () => {
    const deps = makeDeps({
      authority: CMO_AUTHORITY,
      activeCount: 0,
      dailyUsd: DAILY_USD_LIMIT, // at the limit
    })

    await expect(
      spawnDelegation({ ...baseInput, workerSlug: 'researcher' }, deps),
    ).rejects.toThrow(/Budget guard blocked/)

    expect(deps.insertDelegation).not.toHaveBeenCalled()
    expect(deps.delegationsQueue.add).not.toHaveBeenCalled()
  })

  it('5b. throws when agents_paused kill switch is set', async () => {
    const deps = makeDeps({
      authority: CMO_AUTHORITY,
      activeCount: 0,
      redisPaused: true,
    })

    await expect(
      spawnDelegation({ ...baseInput, workerSlug: 'researcher' }, deps),
    ).rejects.toThrow(/Budget guard blocked/)
  })

  it('throws AuthorityError when persona not found (null authority)', async () => {
    const deps = makeDeps({ authority: null })

    await expect(
      spawnDelegation({ ...baseInput, workerSlug: 'researcher' }, deps),
    ).rejects.toThrow(AuthorityError)
  })

  it('inserts delegation with correct budget fields', async () => {
    const deps = makeDeps({ authority: CMO_AUTHORITY, activeCount: 0 })
    const budget = { maxUsd: 3, maxSeconds: 120, maxToolCalls: 10 }

    await spawnDelegation({ ...baseInput, budget }, deps)

    const insertCall = vi.mocked(deps.insertDelegation).mock.calls[0]![0]
    expect(insertCall.budget.maxUsd).toBe(3)
    expect(insertCall.budget.maxSeconds).toBe(120)
    expect(insertCall.budget.maxToolCalls).toBe(10)
  })

  it('inserts delegation with null budget fields when budget is omitted', async () => {
    const deps = makeDeps({ authority: CMO_AUTHORITY, activeCount: 0 })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { budget: _b, ...inputWithoutBudget } = baseInput

    await spawnDelegation(inputWithoutBudget, deps)

    const insertCall = vi.mocked(deps.insertDelegation).mock.calls[0]![0]
    expect(insertCall.budget.maxUsd).toBeNull()
    expect(insertCall.budget.maxSeconds).toBeNull()
    expect(insertCall.budget.maxToolCalls).toBeNull()
  })
})
