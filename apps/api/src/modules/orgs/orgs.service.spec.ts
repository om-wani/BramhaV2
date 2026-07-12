import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@bramha/db', () => ({ withTenant: vi.fn() }))

import { NotFoundException, ForbiddenException } from '@nestjs/common'
import { OrgsService } from './orgs.service.js'
import type { RlsDbService } from '../common/db/rls-db.service.js'
import type { AuthDbService } from '../auth/auth-db.service.js'
import type postgres from 'postgres'

const ACTOR_ID = '550e8400-e29b-41d4-a716-446655440000'
const TARGET_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

function makeTx(results: unknown[][]): postgres.TransactionSql {
  let call = 0
  return vi.fn().mockImplementation(
    () => Promise.resolve(results[call++] ?? []),
  ) as unknown as postgres.TransactionSql
}

function buildMocks() {
  const db: Partial<RlsDbService> = { run: vi.fn() }
  const authDb: Partial<AuthDbService> = { findUserByEmail: vi.fn() }
  return { db, authDb }
}

describe('OrgsService', () => {
  let svc: OrgsService
  let mocks: ReturnType<typeof buildMocks>

  beforeEach(() => {
    mocks = buildMocks()
    svc = new OrgsService(mocks.db as RlsDbService, mocks.authDb as AuthDbService)
  })

  // ── Security: IDOR / membership checks ──────────────────────────────────

  describe('update', () => {
    it('non-member gets NotFoundException (no existence leak)', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // tx returns [] for the membership SELECT — user is not a member
        return fn(makeTx([[]]))
      })
      await expect(svc.update(ACTOR_ID, ORG_ID, { name: 'New' })).rejects.toThrow(NotFoundException)
    })

    it('member (non-owner) gets ForbiddenException', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // tx returns [{ role: 'member' }] — user is a member but not owner
        return fn(makeTx([[{ role: 'member' }]]))
      })
      await expect(svc.update(ACTOR_ID, ORG_ID, { name: 'New' })).rejects.toThrow(
        ForbiddenException,
      )
    })
  })

  describe('deleteOrg', () => {
    it('non-member gets NotFoundException', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[]]))
      })
      await expect(svc.deleteOrg(ACTOR_ID, ORG_ID)).rejects.toThrow(NotFoundException)
    })

    it('admin (non-owner) gets ForbiddenException', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[{ role: 'admin' }]]))
      })
      await expect(svc.deleteOrg(ACTOR_ID, ORG_ID)).rejects.toThrow(ForbiddenException)
    })
  })

  // ── Last-owner removal ──────────────────────────────────────────────────

  describe('removeMember', () => {
    it('blocks removal of the last owner', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // Call order: 1) actor membership  → [{ role: 'owner' }]
        //             2) target membership → [{ role: 'owner' }]  (target IS an owner)
        //             3) owner count       → [{ count: '1' }]     (only 1 owner → block)
        return fn(makeTx([[{ role: 'owner' }], [{ role: 'owner' }], [{ count: '1' }]]))
      })
      await expect(svc.removeMember(ACTOR_ID, ORG_ID, ACTOR_ID)).rejects.toThrow(ForbiddenException)
    })

    it('allows removal of a member (non-owner)', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // Call order: 1) actor membership  → [{ role: 'owner' }]
        //             2) target membership → [{ role: 'member' }] (not owner, skip count check)
        //             3) DELETE            → []
        return fn(makeTx([[{ role: 'owner' }], [{ role: 'member' }], []]))
      })
      await expect(svc.removeMember(ACTOR_ID, ORG_ID, TARGET_ID)).resolves.toBeUndefined()
    })
  })

  // ── Role escalation ─────────────────────────────────────────────────────

  describe('updateMemberRole', () => {
    it('member cannot change roles (ForbiddenException)', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // actor's membership → role: 'member'
        return fn(makeTx([[{ role: 'member' }]]))
      })
      await expect(
        svc.updateMemberRole(ACTOR_ID, ORG_ID, TARGET_ID, 'admin'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('admin cannot escalate to owner', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[{ role: 'admin' }]]))
      })
      await expect(
        svc.updateMemberRole(ACTOR_ID, ORG_ID, TARGET_ID, 'owner'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('owner can grant owner role', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // actor membership, then UPDATE returns []
        return fn(makeTx([[{ role: 'owner' }], []]))
      })
      await expect(
        svc.updateMemberRole(ACTOR_ID, ORG_ID, TARGET_ID, 'owner'),
      ).resolves.toBeUndefined()
    })
  })
})
