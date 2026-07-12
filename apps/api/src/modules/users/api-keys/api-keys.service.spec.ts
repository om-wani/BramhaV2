import { vi, describe, it, expect, beforeEach } from 'vitest'

import { createHash } from 'crypto'
import { NotFoundException } from '@nestjs/common'
import { ApiKeysService } from './api-keys.service.js'
import type { RlsDbService } from '../../common/db/rls-db.service.js'
import type { AuthDbService } from '../../auth/auth-db.service.js'

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const KEY_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

function buildMocks() {
  const rlsDb: Partial<RlsDbService> = {
    run: vi.fn(),
  }
  const authDb: Partial<AuthDbService> = {
    findApiKeyByKeyId: vi.fn(),
    touchApiKeyLastUsed: vi.fn(),
  }
  return { rlsDb, authDb }
}

describe('ApiKeysService', () => {
  let svc: ApiKeysService
  let mocks: ReturnType<typeof buildMocks>

  beforeEach(() => {
    mocks = buildMocks()
    svc = new ApiKeysService(mocks.rlsDb as RlsDbService, mocks.authDb as AuthDbService)
  })

  describe('generateKey()', () => {
    it('returns a raw key with bmv2_ prefix', () => {
      const { raw } = (svc as unknown as { generateKey(): { raw: string; keyId: string; keyHash: string } }).generateKey()
      expect(raw).toMatch(/^bmv2_[0-9a-f]{8}_/)
    })

    it('keyId is 8 lowercase hex chars', () => {
      const { keyId } = (svc as unknown as { generateKey(): { raw: string; keyId: string; keyHash: string } }).generateKey()
      expect(keyId).toMatch(/^[0-9a-f]{8}$/)
    })

    it('keyHash is sha256 hex of the raw key', () => {
      const { raw, keyHash } = (svc as unknown as { generateKey(): { raw: string; keyId: string; keyHash: string } }).generateKey()
      const expected = createHash('sha256').update(raw).digest('hex')
      expect(keyHash).toBe(expected)
    })

    it('generates unique keys on each call', () => {
      const gen = (svc as unknown as { generateKey(): { raw: string; keyId: string; keyHash: string } }).generateKey
      const a = gen.call(svc)
      const b = gen.call(svc)
      expect(a.raw).not.toBe(b.raw)
      expect(a.keyId).not.toBe(b.keyId)
    })
  })

  describe('create()', () => {
    it('returns raw key and metadata without key_hash', async () => {
      vi.mocked(mocks.rlsDb.run!).mockImplementation(async (_ctx, fn) => {
        const tx = vi.fn().mockResolvedValue([
          {
            id: KEY_UUID,
            name: 'My Key',
            scopes: ['read'],
            created_at: new Date('2024-01-01'),
          },
        ])
        return fn(tx as unknown as Parameters<typeof fn>[0])
      })

      const result = await svc.create(USER_ID, { name: 'My Key', scopes: ['read'] })

      expect(result.raw).toMatch(/^bmv2_/)
      expect(result.id).toBe(KEY_UUID)
      expect(result.name).toBe('My Key')
      expect(result.scopes).toEqual(['read'])
      expect(result).not.toHaveProperty('key_hash')
      expect(result).not.toHaveProperty('keyHash')
    })
  })

  describe('list()', () => {
    it('returns key metadata without key_hash field', async () => {
      vi.mocked(mocks.rlsDb.run!).mockImplementation(async (_ctx, fn) => {
        const tx = vi.fn().mockResolvedValue([
          {
            id: KEY_UUID,
            name: 'My Key',
            scopes: ['read', 'write'],
            last_used_at: null,
            created_at: new Date('2024-01-01'),
          },
        ])
        return fn(tx as unknown as Parameters<typeof fn>[0])
      })

      const result = await svc.list(USER_ID)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: KEY_UUID,
        name: 'My Key',
        scopes: ['read', 'write'],
        lastUsedAt: null,
      })
      expect(result[0]).not.toHaveProperty('key_hash')
      expect(result[0]).not.toHaveProperty('keyHash')
    })
  })

  describe('revoke()', () => {
    it('throws NotFoundException when no rows are updated', async () => {
      vi.mocked(mocks.rlsDb.run!).mockImplementation(async (_ctx, fn) => {
        const tx = vi.fn().mockResolvedValue([]) // 0 rows updated
        return fn(tx as unknown as Parameters<typeof fn>[0])
      })

      await expect(svc.revoke(USER_ID, KEY_UUID)).rejects.toThrow(NotFoundException)
    })

    it('resolves without error when key is revoked successfully', async () => {
      vi.mocked(mocks.rlsDb.run!).mockImplementation(async (_ctx, fn) => {
        const tx = vi.fn().mockResolvedValue([{ id: KEY_UUID }])
        return fn(tx as unknown as Parameters<typeof fn>[0])
      })

      await expect(svc.revoke(USER_ID, KEY_UUID)).resolves.toBeUndefined()
    })
  })

  describe('validateKey()', () => {
    it('returns null for keys without bmv2_ prefix', async () => {
      const result = await svc.validateKey('sk_live_something')
      expect(result).toBeNull()
    })

    it('returns null for keys with malformed keyId length', async () => {
      // keyId must be 8 chars, this has only 4
      const result = await svc.validateKey('bmv2_abcd_secretpart')
      expect(result).toBeNull()
    })

    it('returns null when key is not found in db', async () => {
      vi.mocked(mocks.authDb.findApiKeyByKeyId!).mockResolvedValue(null)
      // Construct a valid-format key
      const result = await svc.validateKey('bmv2_a1b2c3d4_' + 'x'.repeat(43))
      expect(result).toBeNull()
    })

    it('returns null for revoked keys', async () => {
      vi.mocked(mocks.authDb.findApiKeyByKeyId!).mockResolvedValue({
        id: KEY_UUID,
        user_id: USER_ID,
        key_hash: 'deadbeef',
        scopes: ['read'],
        revoked_at: '2024-01-01T00:00:00Z',
      })
      const result = await svc.validateKey('bmv2_a1b2c3d4_' + 'x'.repeat(43))
      expect(result).toBeNull()
    })

    it('returns user info for a valid key', async () => {
      // Generate a real key to get a valid hash
      const gen = (svc as unknown as { generateKey(): { raw: string; keyId: string; keyHash: string } }).generateKey
      const { raw, keyHash } = gen.call(svc)

      vi.mocked(mocks.authDb.findApiKeyByKeyId!).mockResolvedValue({
        id: KEY_UUID,
        user_id: USER_ID,
        key_hash: keyHash,
        scopes: ['read'],
        revoked_at: null,
      })
      vi.mocked(mocks.authDb.touchApiKeyLastUsed!).mockResolvedValue(undefined)

      const result = await svc.validateKey(raw)
      expect(result).not.toBeNull()
      expect(result?.userId).toBe(USER_ID)
      expect(result?.scopes).toEqual(['read'])
    })

    it('returns null when hash does not match', async () => {
      const gen = (svc as unknown as { generateKey(): { raw: string; keyId: string; keyHash: string } }).generateKey
      const { raw } = gen.call(svc)

      vi.mocked(mocks.authDb.findApiKeyByKeyId!).mockResolvedValue({
        id: KEY_UUID,
        user_id: USER_ID,
        key_hash: 'a'.repeat(64), // wrong hash
        scopes: ['read'],
        revoked_at: null,
      })

      const result = await svc.validateKey(raw)
      expect(result).toBeNull()
    })

    it('validateKey returns null when DB throws', async () => {
      vi.mocked(mocks.authDb.findApiKeyByKeyId!).mockRejectedValue(new Error('connection lost'))
      const result = await svc.validateKey('bmv2_a1b2c3d4_somesecret')
      expect(result).toBeNull()
    })
  })
})
