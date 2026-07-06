import { Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes, createHash, timingSafeEqual } from 'crypto'
import { RlsDbService } from '../../common/db/rls-db.service'
import { AuthDbService } from '../../auth/auth-db.service'
import type { CreateApiKeyInput } from '@bramha/shared'

const PREFIX = 'bmv2'
const KEY_ID_BYTES = 4 // → 8 hex chars

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly rlsDb: RlsDbService,
    private readonly authDb: AuthDbService,
  ) {}

  private generateKey(): { raw: string; keyId: string; keyHash: string } {
    const keyId = randomBytes(KEY_ID_BYTES).toString('hex')
    const secret = randomBytes(32).toString('base64url')
    const raw = `${PREFIX}_${keyId}_${secret}`
    const keyHash = createHash('sha256').update(raw).digest('hex')
    return { raw, keyId, keyHash }
  }

  async create(
    userId: string,
    input: CreateApiKeyInput,
  ): Promise<{ raw: string; id: string; name: string; scopes: string[]; createdAt: Date }> {
    const { raw, keyId, keyHash } = this.generateKey()

    const row = await this.rlsDb.run({ userId }, async (tx) => {
      const rows = await tx<
        { id: string; name: string; scopes: string[]; created_at: Date }[]
      >`
        INSERT INTO api_keys (user_id, name, key_id, key_hash, scopes)
        VALUES (${userId}, ${input.name}, ${keyId}, ${keyHash}, ${input.scopes})
        RETURNING id, name, scopes, created_at
      `
      if (!rows[0]) throw new Error('API key insert returned no row')
      return rows[0]
    })

    return {
      raw,
      id: row.id,
      name: row.name,
      scopes: row.scopes,
      createdAt: row.created_at,
    }
  }

  async list(
    userId: string,
  ): Promise<
    Array<{ id: string; name: string; scopes: string[]; lastUsedAt: Date | null; createdAt: Date }>
  > {
    return this.rlsDb.run({ userId }, async (tx) => {
      const rows = await tx<
        {
          id: string
          name: string
          scopes: string[]
          last_used_at: Date | null
          created_at: Date
        }[]
      >`
        SELECT id, name, scopes, last_used_at, created_at
        FROM   api_keys
        WHERE  user_id = ${userId} AND revoked_at IS NULL
        ORDER BY created_at DESC
      `
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        scopes: r.scopes,
        lastUsedAt: r.last_used_at,
        createdAt: r.created_at,
      }))
    })
  }

  async revoke(userId: string, id: string): Promise<void> {
    await this.rlsDb.run({ userId }, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        UPDATE api_keys
        SET    revoked_at = now()
        WHERE  id = ${id} AND user_id = ${userId} AND revoked_at IS NULL
        RETURNING id
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
    })
  }

  /**
   * Validates a raw API key. Uses the superuser (authDb) connection to bypass RLS.
   * Returns the associated userId, internal keyId, and scopes on success, or null on failure.
   */
  async validateKey(
    rawKey: string,
  ): Promise<{ userId: string; keyId: string; scopes: string[] } | null> {
    // 1. Parse prefix
    if (!rawKey.startsWith(`${PREFIX}_`)) return null
    const rest = rawKey.slice(PREFIX.length + 1)
    const underscoreIdx = rest.indexOf('_')
    if (underscoreIdx !== KEY_ID_BYTES * 2) return null // key_id must be 8 chars

    const keyId = rest.slice(0, KEY_ID_BYTES * 2)

    try {
      // 2. Lookup by key_id using authDb (superuser, bypasses RLS)
      const row = await this.authDb.findApiKeyByKeyId(keyId)
      if (!row || row.revoked_at) return null

      // 3. Constant-time hash compare
      const incoming = new Uint8Array(createHash('sha256').update(rawKey).digest())
      const stored = new Uint8Array(Buffer.from(row.key_hash, 'hex'))
      if (incoming.length !== stored.length) return null
      if (!timingSafeEqual(incoming, stored)) return null

      // 4. Update last_used_at best-effort (don't await, don't throw)
      this.authDb.touchApiKeyLastUsed(row.id).catch(() => {
        /* best-effort */
      })

      return { userId: row.user_id, keyId: row.id, scopes: row.scopes }
    } catch {
      return null
    }
  }
}
