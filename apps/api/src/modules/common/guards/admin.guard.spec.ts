import { vi, describe, it, expect, beforeEach } from 'vitest'
import { ForbiddenException } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import { AdminGuard } from './admin.guard.js'
import type { RlsDbService } from '../db/rls-db.service.js'
import type postgres from 'postgres'

// ── Helpers ───────────────────────────────────────────────────────────────────

interface UserRecord {
  is_admin: boolean
  totp_enabled: boolean
}

function buildGuard(rows: UserRecord[]): AdminGuard {
  const tx = vi.fn().mockResolvedValue(rows) as unknown as postgres.TransactionSql
  const db = {
    run: vi.fn().mockImplementation(async (_ctx: unknown, fn: (t: postgres.TransactionSql) => Promise<unknown>) => {
      return fn(tx)
    }),
  } as unknown as RlsDbService
  return new AdminGuard(db)
}

function makeContext(user: { userId: string; twoFactorVerified?: boolean } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows admin user without TOTP enabled', async () => {
    const guard = buildGuard([{ is_admin: true, totp_enabled: false }])
    const ctx = makeContext({ userId: 'user-1', twoFactorVerified: false })
    await expect(guard.canActivate(ctx)).resolves.toBe(true)
  })

  it('allows admin with TOTP enabled and twoFactorVerified: true', async () => {
    const guard = buildGuard([{ is_admin: true, totp_enabled: true }])
    const ctx = makeContext({ userId: 'user-1', twoFactorVerified: true })
    await expect(guard.canActivate(ctx)).resolves.toBe(true)
  })

  it('blocks admin with TOTP enabled but twoFactorVerified: false', async () => {
    const guard = buildGuard([{ is_admin: true, totp_enabled: true }])
    const ctx = makeContext({ userId: 'user-1', twoFactorVerified: false })
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException)
  })

  it('blocks admin with TOTP enabled when twoFactorVerified is absent', async () => {
    const guard = buildGuard([{ is_admin: true, totp_enabled: true }])
    const ctx = makeContext({ userId: 'user-1' })
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException)
  })

  it('blocks non-admin user', async () => {
    const guard = buildGuard([{ is_admin: false, totp_enabled: false }])
    const ctx = makeContext({ userId: 'user-1', twoFactorVerified: false })
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException)
  })

  it('blocks when no user on request', async () => {
    const guard = buildGuard([])
    const ctx = makeContext(undefined)
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException)
  })
})
