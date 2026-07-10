import { vi, describe, it, expect, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@bramha/db', () => ({ withTenant: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { BadRequestException } from '@nestjs/common'
import { ApprovalsService } from './approvals.service'
import type { RlsDbService } from '../common/db/rls-db.service'
import type postgres from 'postgres'

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_ID = '550e8400-e29b-41d4-a716-446655440001'
const PROJECT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'
const APPROVAL_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c9'
const PERSONA_ID = 'persona-aaa-000-111'
const ARGS_HASH = 'abc123def4567890'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTx(results: unknown[][]): postgres.TransactionSql {
  let call = 0
  return vi.fn().mockImplementation(
    () => Promise.resolve(results[call++] ?? []),
  ) as unknown as postgres.TransactionSql
}

function makeApprovalRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: APPROVAL_ID,
    project_id: PROJECT_ID,
    requested_by_persona: PERSONA_ID,
    delegation_id: null,
    action_summary: `connector-xyz:query_data`,
    payload_hash: ARGS_HASH,
    status: 'pending',
    decided_by: null,
    decided_at: null,
    expires_at: '2026-07-11T00:00:00+00:00',
    created_at: '2026-07-10T00:00:00+00:00',
    ...overrides,
  }
}

function buildMocks() {
  const db: Partial<RlsDbService> = { run: vi.fn() }
  const redis = { publish: vi.fn().mockResolvedValue(0) }
  return { db, redis }
}

function buildService(mocks: ReturnType<typeof buildMocks>): ApprovalsService {
  return new ApprovalsService(
    mocks.db as RlsDbService,
    mocks.redis as unknown as import('ioredis').default,
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ApprovalsService', () => {
  let svc: ApprovalsService
  let mocks: ReturnType<typeof buildMocks>

  beforeEach(() => {
    mocks = buildMocks()
    svc = buildService(mocks)
  })

  // 1. POST creates approval + emits event
  it('createApproval inserts a row and emits approval.requested event', async () => {
    const approvalRow = makeApprovalRow()
    vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
      return fn(makeTx([[approvalRow]]))
    })
    const publishSpy = vi.spyOn(svc['publisher'], 'publish').mockResolvedValue(undefined)

    const result = await svc.createApproval(USER_ID, PROJECT_ID, {
      personaId: PERSONA_ID,
      toolName: 'query_data',
      connectorId: 'connector-xyz',
      argsHash: ARGS_HASH,
    })

    expect(result.id).toBe(APPROVAL_ID)
    expect(result.status).toBe('pending')
    expect(result.payloadHash).toBe(ARGS_HASH)
    expect(publishSpy).toHaveBeenCalledWith(
      `approval.requested:${PROJECT_ID}`,
      expect.objectContaining({ approvalId: APPROVAL_ID }),
    )
  })

  // 2. GET returns approval
  it('getApproval returns approval DTO when found', async () => {
    const approvalRow = makeApprovalRow()
    vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
      return fn(makeTx([[approvalRow]]))
    })

    const result = await svc.getApproval(USER_ID, PROJECT_ID, APPROVAL_ID)

    expect(result.id).toBe(APPROVAL_ID)
    expect(result.projectId).toBe(PROJECT_ID)
    expect(result.requestedByPersona).toBe(PERSONA_ID)
  })

  // 3. decide with correct argsHash → 200, event emitted
  it('decideApproval with correct argsHash approves and emits approval.decided event', async () => {
    const pendingRow = makeApprovalRow()
    const approvedRow = makeApprovalRow({ status: 'approved', decided_by: USER_ID, decided_at: '2026-07-10T01:00:00+00:00' })

    vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
      // First tx call returns pending row for status check, second returns updated
      return fn(makeTx([[pendingRow], [approvedRow]]))
    })
    const publishSpy = vi.spyOn(svc['publisher'], 'publish').mockResolvedValue(undefined)

    const result = await svc.decideApproval(USER_ID, PROJECT_ID, APPROVAL_ID, {
      decision: 'approved',
      argsHash: ARGS_HASH,
    })

    expect(result.status).toBe('approved')
    expect(publishSpy).toHaveBeenCalledWith(
      `approval.decided:${PROJECT_ID}`,
      expect.objectContaining({ approvalId: APPROVAL_ID, decision: 'approved' }),
    )
  })

  // 4. decide with wrong argsHash → 400 (tamper test)
  it('decideApproval throws BadRequestException when argsHash does not match', async () => {
    const pendingRow = makeApprovalRow({ payload_hash: ARGS_HASH })

    vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
      return fn(makeTx([[pendingRow]]))
    })

    await expect(
      svc.decideApproval(USER_ID, PROJECT_ID, APPROVAL_ID, {
        decision: 'approved',
        argsHash: 'wrong-hash-value',
      }),
    ).rejects.toThrow(BadRequestException)
  })
})
