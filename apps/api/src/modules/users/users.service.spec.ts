import { vi, describe, it, expect, beforeEach } from 'vitest'

// Must be hoisted before @bramha/db loads to prevent real postgres init
vi.mock('@bramha/db', () => ({ withTenant: vi.fn() }))

import { NotFoundException } from '@nestjs/common'
import { UsersService } from './users.service.js'
import type { RlsDbService } from '../common/db/rls-db.service.js'

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const OTHER_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

function makeUserRow() {
  return {
    id: USER_ID,
    email: 'alice@example.com',
    display_name: 'Alice',
    avatar_key: null,
    email_verified_at: '2024-01-01T00:00:00+00:00',
    is_admin: false,
    status: 'active',
    created_at: '2024-01-01T00:00:00+00:00',
    updated_at: '2024-01-01T00:00:00+00:00',
  }
}

function buildMocks() {
  const db: Partial<RlsDbService> = {
    run: vi.fn(),
  }
  return { db }
}

describe('UsersService', () => {
  let svc: UsersService
  let mocks: ReturnType<typeof buildMocks>

  beforeEach(() => {
    mocks = buildMocks()
    svc = new UsersService(mocks.db as RlsDbService)
  })

  describe('getMe', () => {
    it('returns profile for own userId', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        const tx = vi.fn().mockResolvedValue([makeUserRow()])
        return fn(tx as unknown as Parameters<typeof fn>[0])
      })
      const result = await svc.getMe(USER_ID)
      expect(result.id).toBe(USER_ID)
      expect(result.displayName).toBe('Alice')
    })

    it('throws NotFoundException when user not found', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        const tx = vi.fn().mockResolvedValue([])
        return fn(tx as unknown as Parameters<typeof fn>[0])
      })
      await expect(svc.getMe(USER_ID)).rejects.toThrow(NotFoundException)
    })
  })

  describe('getPublicProfile', () => {
    it('returns id, displayName, avatarKey only', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        const tx = vi.fn().mockResolvedValue([
          {
            id: OTHER_ID,
            display_name: 'Bob',
            avatar_key: null,
          },
        ])
        return fn(tx as unknown as Parameters<typeof fn>[0])
      })
      const result = await svc.getPublicProfile(USER_ID, OTHER_ID)
      expect(result.id).toBe(OTHER_ID)
      expect(result.displayName).toBe('Bob')
      expect(Object.keys(result)).toEqual(['id', 'displayName', 'avatarKey'])
    })

    it('throws NotFoundException when target user not found', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        const tx = vi.fn().mockResolvedValue([])
        return fn(tx as unknown as Parameters<typeof fn>[0])
      })
      await expect(svc.getPublicProfile(USER_ID, OTHER_ID)).rejects.toThrow(NotFoundException)
    })
  })
})
