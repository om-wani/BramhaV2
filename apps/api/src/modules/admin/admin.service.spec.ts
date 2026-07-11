import { vi, describe, it, expect, beforeEach } from 'vitest'

// ── Mocks (hoisted before imports by vitest) ──────────────────────────────────

vi.mock('@bramha/db', () => ({
  withAdmin: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    getWaitingCount: vi.fn().mockResolvedValue(0),
    getActiveCount:  vi.fn().mockResolvedValue(0),
    getDelayedCount: vi.fn().mockResolvedValue(0),
    getFailedCount:  vi.fn().mockResolvedValue(0),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { NotFoundException } from '@nestjs/common'
import { withAdmin } from '@bramha/db'
import { AdminService } from './admin.service'
import type postgres from 'postgres'

const withAdminMock = vi.mocked(withAdmin)

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTOR_ID     = '11111111-1111-1111-1111-111111111111'
const USER_ID      = '22222222-2222-2222-2222-222222222222'
const PERSONA_ID   = '10000000-0000-0000-0000-000000000001'
const POLICY_ID    = '33333333-3333-3333-3333-333333333333'
const GRANT_ID     = '44444444-4444-4444-4444-444444444444'
const PROJECT_ID   = '55555555-5555-5555-5555-555555555555'
const CONNECTOR_ID = '66666666-6666-6666-6666-666666666666'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a mock TransactionSql that returns results in sequence */
function makeTx(results: unknown[][]): postgres.TransactionSql {
  let call = 0
  const fn = vi.fn().mockImplementation(() => Promise.resolve(results[call++] ?? []))
  return fn as unknown as postgres.TransactionSql
}

function makeUserRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: USER_ID,
    email: 'user@example.com',
    display_name: 'Test User',
    is_admin: false,
    status: 'active',
    totp_secret_enc: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makePolicyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: POLICY_ID,
    persona_id: PERSONA_ID,
    tier: 'csuite',
    primary_provider: 'anthropic',
    primary_model: 'claude-sonnet-4-5',
    fallbacks: [],
    max_input_tokens: 32000,
    max_output_tokens: 4096,
    temperature: 0.7,
    per_turn_usd: '0.50',
    per_day_usd: '20.00',
    prompt_caching: true,
    ...overrides,
  }
}

function makeGrantRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: GRANT_ID,
    project_id: PROJECT_ID,
    persona_id: PERSONA_ID,
    connector_id: CONNECTOR_ID,
    allowed_scopes: ['read'],
    requires_approval: false,
    expires_at: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeAuditRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '77777777-7777-7777-7777-777777777777',
    actor_id: ACTOR_ID,
    action: 'admin.user.suspend',
    target_type: 'user',
    target_id: USER_ID,
    project_id: null,
    payload: {},
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

/** Build service with mocked Redis */
function buildService(): AdminService {
  const redis = {} as unknown as import('ioredis').default
  return new AdminService(redis)
}

/**
 * Configure withAdmin to call through to fn with a given mock tx.
 * Returns the mock tx so tests can inspect it.
 */
function mockAdminRun(txResults: unknown[][]): postgres.TransactionSql {
  const tx = makeTx(txResults)
  withAdminMock.mockImplementationOnce(async (fn) => fn(tx))
  return tx
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── suspendUser ──────────────────────────────────────────────────────────────

  describe('suspendUser', () => {
    it('updates user status and inserts audit_log row (two adminRun calls)', async () => {
      const svc = buildService()

      // Call 1: UPDATE users (returns the updated row)
      mockAdminRun([[makeUserRow({ id: USER_ID })]])
      // Call 2: audit_log INSERT (returns nothing meaningful)
      mockAdminRun([[]])

      await svc.suspendUser(ACTOR_ID, USER_ID)

      // withAdmin should have been called twice: once for suspend, once for audit log
      expect(withAdminMock).toHaveBeenCalledTimes(2)
    })

    it('throws NotFoundException when user does not exist', async () => {
      const svc = buildService()

      // UPDATE returns no rows → NotFoundException inside adminRun
      mockAdminRun([[]])

      await expect(svc.suspendUser(ACTOR_ID, USER_ID)).rejects.toThrow(NotFoundException)
    })
  })

  // ── resetTwoFactor ────────────────────────────────────────────────────────────

  describe('resetTwoFactor', () => {
    it('clears totp_secret_enc, deletes recovery codes, inserts audit log', async () => {
      const svc = buildService()

      // Call 1: UPDATE users + DELETE recovery_codes (both in same adminRun)
      mockAdminRun([[makeUserRow()], []])
      // Call 2: audit_log INSERT
      mockAdminRun([[]])

      await expect(svc.resetTwoFactor(ACTOR_ID, USER_ID)).resolves.toBeUndefined()
      expect(withAdminMock).toHaveBeenCalledTimes(2)
    })

    it('throws NotFoundException when user does not exist', async () => {
      const svc = buildService()
      mockAdminRun([[]])

      await expect(svc.resetTwoFactor(ACTOR_ID, USER_ID)).rejects.toThrow(NotFoundException)
    })
  })

  // ── updateModelPolicy ─────────────────────────────────────────────────────────

  describe('updateModelPolicy', () => {
    it('updates model and inserts audit_log row', async () => {
      const svc = buildService()
      const updatedPolicy = makePolicyRow({ primary_model: 'claude-opus-4-5' })

      // Call 1: SELECT current + UPDATE RETURNING (two sequential queries in same tx)
      mockAdminRun([[makePolicyRow()], [updatedPolicy]])
      // Call 2: audit_log INSERT
      mockAdminRun([[]])

      const result = await svc.updateModelPolicy(ACTOR_ID, PERSONA_ID, {
        primaryModel: 'claude-opus-4-5',
      })

      expect(result.primaryModel).toBe('claude-opus-4-5')
      expect(withAdminMock).toHaveBeenCalledTimes(2)
    })

    it('throws NotFoundException when policy does not exist', async () => {
      const svc = buildService()
      mockAdminRun([[]])

      await expect(
        svc.updateModelPolicy(ACTOR_ID, PERSONA_ID, { primaryModel: 'gpt-4o' }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  // ── upsertGrant ───────────────────────────────────────────────────────────────

  describe('upsertGrant', () => {
    it('inserts/updates grant row and inserts audit_log', async () => {
      const svc = buildService()

      // Call 1: upsert grant
      mockAdminRun([[makeGrantRow()]])
      // Call 2: audit_log INSERT
      mockAdminRun([[]])

      const result = await svc.upsertGrant(ACTOR_ID, {
        projectId:        PROJECT_ID,
        personaId:        PERSONA_ID,
        connectorId:      CONNECTOR_ID,
        allowedScopes:    ['read'],
        requiresApproval: false,
      })

      expect(result.id).toBe(GRANT_ID)
      expect(withAdminMock).toHaveBeenCalledTimes(2)
    })
  })

  // ── getTokenUsage ─────────────────────────────────────────────────────────────

  describe('getTokenUsage', () => {
    it('returns mapped token usage rows from token_usage_daily', async () => {
      const svc = buildService()

      const usageRow = {
        project_id:    PROJECT_ID,
        persona_id:    PERSONA_ID,
        model:         'claude-sonnet-4-5',
        day:           '2024-01-01T00:00:00Z',
        input_tokens:  '1000',
        output_tokens: '500',
        cost_usd:      '0.015',
      }

      mockAdminRun([[usageRow]])

      const result = await svc.getTokenUsage()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        projectId:    PROJECT_ID,
        model:        'claude-sonnet-4-5',
        inputTokens:  1000,
        outputTokens: 500,
        costUsd:      0.015,
      })
    })
  })

  // ── searchAuditLog ────────────────────────────────────────────────────────────

  describe('searchAuditLog', () => {
    it('returns audit entries filtered by actorId and date range', async () => {
      const svc = buildService()

      mockAdminRun([[makeAuditRow()]])

      const results = await svc.searchAuditLog({
        actorId: ACTOR_ID,
        from:    '2024-01-01T00:00:00Z',
        to:      '2024-01-31T23:59:59Z',
      })

      expect(results).toHaveLength(1)
      expect(results[0]?.actorId).toBe(ACTOR_ID)
      expect(results[0]?.action).toBe('admin.user.suspend')
    })

    it('returns empty array when no entries match', async () => {
      const svc = buildService()
      mockAdminRun([[]])

      const results = await svc.searchAuditLog({ limit: 9999 })
      expect(results).toEqual([])
    })
  })
})
