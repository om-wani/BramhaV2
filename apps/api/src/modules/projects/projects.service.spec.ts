import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@bramha/db', () => ({ withTenant: vi.fn() }))

import { NotFoundException, ForbiddenException } from '@nestjs/common'
import { ProjectsService } from './projects.service'
import type { RlsDbService } from '../common/db/rls-db.service'
import type postgres from 'postgres'

const ACTOR_ID = '550e8400-e29b-41d4-a716-446655440000'
const TARGET_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const PROJECT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const ORG_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

function makeTx(results: unknown[][]): postgres.TransactionSql {
  let call = 0
  return vi.fn().mockImplementation(
    () => Promise.resolve(results[call++] ?? []),
  ) as unknown as postgres.TransactionSql
}

function buildMocks() {
  const db: Partial<RlsDbService> = { run: vi.fn() }
  return { db }
}

describe('ProjectsService', () => {
  let svc: ProjectsService
  let mocks: ReturnType<typeof buildMocks>

  beforeEach(() => {
    mocks = buildMocks()
    svc = new ProjectsService(mocks.db as RlsDbService)
  })

  // ── Security: IDOR ───────────────────────────────────────────────────────

  describe('getById', () => {
    it('outsider (no membership) gets NotFoundException', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[]]))
      })
      await expect(svc.getById(ACTOR_ID, PROJECT_ID)).rejects.toThrow(NotFoundException)
    })

    it('member can retrieve project', async () => {
      const projectRow = {
        id: PROJECT_ID,
        org_id: ORG_ID,
        name: 'My Project',
        description: null,
        settings: '{}',
        archived_at: null,
        created_at: '2024-01-01T00:00:00+00:00',
        updated_at: '2024-01-01T00:00:00+00:00',
      }
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[projectRow]]))
      })
      const result = await svc.getById(ACTOR_ID, PROJECT_ID)
      expect(result.id).toBe(PROJECT_ID)
    })
  })

  // ── Role checks ──────────────────────────────────────────────────────────

  describe('archive', () => {
    it('viewer cannot archive project (ForbiddenException)', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // membership check returns 'viewer'
        return fn(makeTx([[{ role: 'viewer' }]]))
      })
      await expect(svc.archive(ACTOR_ID, PROJECT_ID)).rejects.toThrow(ForbiddenException)
    })

    it('editor cannot archive project (ForbiddenException)', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[{ role: 'editor' }]]))
      })
      await expect(svc.archive(ACTOR_ID, PROJECT_ID)).rejects.toThrow(ForbiddenException)
    })
  })

  // ── Last-owner removal ───────────────────────────────────────────────────

  describe('removeMember', () => {
    it('blocks removal of the last project owner', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // Call order: 1) actor membership  → [{ role: 'owner' }]
        //             2) target membership → [{ role: 'owner' }]  (target IS an owner)
        //             3) owner count       → [{ count: '1' }]     (only 1 owner → block)
        return fn(makeTx([[{ role: 'owner' }], [{ role: 'owner' }], [{ count: '1' }]]))
      })
      await expect(svc.removeMember(ACTOR_ID, PROJECT_ID, ACTOR_ID)).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('allows removing a viewer (non-owner)', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // Call order: 1) actor membership  → [{ role: 'owner' }]
        //             2) target membership → [{ role: 'viewer' }] (not owner, skip count check)
        //             3) DELETE            → []
        return fn(makeTx([[{ role: 'owner' }], [{ role: 'viewer' }], []]))
      })
      await expect(svc.removeMember(ACTOR_ID, PROJECT_ID, TARGET_ID)).resolves.toBeUndefined()
    })
  })
})
