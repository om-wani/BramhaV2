/**
 * DelegationManager — orchestrates the full delegation lifecycle.
 *
 * spawnDelegation is the single entry point for creating a delegation.
 * It validates authority, enforces concurrency and budget caps, persists
 * the delegation row, enqueues the BullMQ job, and emits the created event.
 *
 * Security:
 *   - Authority is checked against agent_personas.delegation_authority.canDelegate.
 *   - Concurrent delegations per persona capped at MAX_CONCURRENT_DELEGATIONS (3).
 *   - Daily USD budget guard (shared with turn engine) blocks scheduling.
 *
 * All I/O is injected via DelegationManagerDeps for testability.
 */

import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { Queue } from 'bullmq'
import type { EventPublisher } from '@bramha/event-bus'
import { checkBudgetGuard } from '../orchestrator/budget-guard.js'
import type { DailyUsdChecker } from '../orchestrator/budget-guard.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_CONCURRENT_DELEGATIONS = 3

// ── Error types ───────────────────────────────────────────────────────────────

/** Thrown when the delegating persona is not authorised to delegate to workerSlug. */
export class AuthorityError extends Error {
  readonly code = 'AUTHORITY_ERROR' as const

  constructor(delegatingPersonaId: string, workerSlug: string) {
    super(
      `Persona ${delegatingPersonaId} is not authorised to delegate to worker '${workerSlug}'`,
    )
    this.name = 'AuthorityError'
  }
}

/** Thrown when the persona already has MAX_CONCURRENT_DELEGATIONS active. */
export class ConcurrentCapError extends Error {
  readonly code = 'CONCURRENT_CAP_ERROR' as const

  constructor(delegatingPersonaId: string) {
    super(
      `Persona ${delegatingPersonaId} has reached the concurrent delegation cap of ${MAX_CONCURRENT_DELEGATIONS}`,
    )
    this.name = 'ConcurrentCapError'
  }
}

// ── Data shapes ───────────────────────────────────────────────────────────────

/** The BullMQ job payload enqueued to the 'delegations' queue. */
export interface DelegationJobData {
  delegationId: string
  projectId: string
  conversationId: string
  branchId: string
  workerSlug: string
  objective: string
  inputs: Record<string, unknown>
  deliverable: string
  budget: { maxUsd?: number; maxSeconds?: number; maxToolCalls?: number }
  originNodeId: string
  delegatingPersonaId: string
}

/** Input to spawnDelegation (typically from the delegate_task tool). */
export interface SpawnDelegationInput {
  delegatingPersonaId: string
  workerSlug: string
  objective: string
  inputs: Record<string, unknown>
  deliverable: string
  budget?: { maxUsd?: number; maxSeconds?: number; maxToolCalls?: number }
  originNodeId: string
  conversationId: string
  projectId: string
  branchId: string
}

/** Narrow slice of the DB insert data for the delegations table. */
export interface DelegationInsertData {
  id: string
  projectId: string
  groupId: string
  parentPersonaId: string
  originNodeId: string
  spec: {
    objective: string
    workerSlug: string
    inputs: Record<string, unknown>
    deliverable: string
    conversationId: string
    branchId: string
    delegatingPersonaId: string
  }
  budget: {
    maxUsd: number | null
    maxSeconds: number | null
    maxToolCalls: number | null
  }
}

// ── Dependency injection ───────────────────────────────────────────────────────

/**
 * All external I/O for spawnDelegation is injected here so tests can mock
 * individual calls without spinning up Redis / Postgres / BullMQ.
 */
export interface DelegationManagerDeps {
  /** Shared (non-subscriber) Redis connection for budget guard. */
  redis: Redis

  /**
   * Load delegation_authority.canDelegate for the delegating persona.
   * Returns null if persona is not found.
   */
  loadPersonaDelegationAuthority: (
    delegatingPersonaId: string,
    projectId: string,
  ) => Promise<{ canDelegate: string[]; perTaskBudgetUsd: number } | null>

  /**
   * Count delegations WHERE parent_persona_id = id AND status IN ('queued','running').
   * Used for the concurrent-cap check.
   */
  countActiveDelegations: (
    delegatingPersonaId: string,
    projectId: string,
  ) => Promise<number>

  /** Persist a new delegation row. */
  insertDelegation: (data: DelegationInsertData) => Promise<void>

  /** BullMQ queue for worker delegation jobs. */
  delegationsQueue: Queue

  /** BullMQ queue for agent-turns (used for report-back scheduling). */
  agentTurnsQueue: Queue

  /** Event publisher — used to emit delegation.created:{projectId}. */
  eventPublisher: EventPublisher

  /** Returns total estimated USD spent today for the given project. */
  checkDailyUsd: DailyUsdChecker
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Create a new delegation.
 *
 * Steps:
 *   1. Validate the delegating persona's delegation_authority.
 *   2. Enforce the per-persona concurrent delegation cap (≤ 3).
 *   3. Check the project daily USD budget.
 *   4. INSERT delegation row with status='queued'.
 *   5. Enqueue BullMQ job on 'delegations' queue.
 *   6. Emit delegation.created:{projectId}.
 *
 * Throws:
 *   AuthorityError     — workerSlug not in canDelegate list.
 *   ConcurrentCapError — persona already has 3 active delegations.
 *   Error              — budget guard blocked (agents_paused or daily_budget_exceeded).
 */
export async function spawnDelegation(
  input: SpawnDelegationInput,
  deps: DelegationManagerDeps,
): Promise<{ delegationId: string }> {
  const {
    delegatingPersonaId,
    workerSlug,
    objective,
    inputs,
    deliverable,
    budget,
    originNodeId,
    conversationId,
    projectId,
    branchId,
  } = input

  // ── 1. Validate delegation authority ────────────────────────────────────────
  const authority = await deps.loadPersonaDelegationAuthority(
    delegatingPersonaId,
    projectId,
  )

  if (!authority) {
    throw new AuthorityError(delegatingPersonaId, workerSlug)
  }

  if (!authority.canDelegate.includes(workerSlug)) {
    throw new AuthorityError(delegatingPersonaId, workerSlug)
  }

  // ── 2. Concurrent cap check ──────────────────────────────────────────────────
  const activeCount = await deps.countActiveDelegations(delegatingPersonaId, projectId)

  if (activeCount >= MAX_CONCURRENT_DELEGATIONS) {
    throw new ConcurrentCapError(delegatingPersonaId)
  }

  // ── 3. Daily budget guard ────────────────────────────────────────────────────
  const budgetResult = await checkBudgetGuard(projectId, deps.redis, deps.checkDailyUsd)
  if (!budgetResult.allowed) {
    throw new Error(`Budget guard blocked delegation: ${budgetResult.reason}`)
  }

  // ── 4. Insert delegation row ─────────────────────────────────────────────────
  const delegationId = randomUUID()
  const groupId = randomUUID()

  const insertData: DelegationInsertData = {
    id: delegationId,
    projectId,
    groupId,
    parentPersonaId: delegatingPersonaId,
    originNodeId,
    spec: {
      objective,
      workerSlug,
      inputs,
      deliverable,
      conversationId,
      branchId,
      delegatingPersonaId,
    },
    budget: {
      maxUsd: budget?.maxUsd ?? null,
      maxSeconds: budget?.maxSeconds ?? null,
      maxToolCalls: budget?.maxToolCalls ?? null,
    },
  }

  await deps.insertDelegation(insertData)

  // ── 5. Enqueue BullMQ job ────────────────────────────────────────────────────
  const jobData: DelegationJobData = {
    delegationId,
    projectId,
    conversationId,
    branchId,
    workerSlug,
    objective,
    inputs,
    deliverable,
    budget: budget ?? {},
    originNodeId,
    delegatingPersonaId,
  }

  await deps.delegationsQueue.add('delegation', jobData)

  // ── 6. Emit delegation.created ───────────────────────────────────────────────
  await deps.eventPublisher.publish(`delegation.created:${projectId}`, {
    delegationId,
    projectId,
    workerSlug,
    objective,
    delegatingPersonaId,
  })

  return { delegationId }
}
