import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { RlsDbService } from '../common/db/rls-db.service'
import type { UpdateProfileInput } from '@bramha/shared'

interface UserRow {
  id: string
  email: string
  display_name: string
  avatar_key: string | null
  email_verified_at: string | null
  is_admin: boolean
  status: string
  created_at: string
  updated_at: string
}

export interface UserProfile {
  id: string
  email: string
  displayName: string
  avatarKey: string | null
  emailVerifiedAt: string | null
  isAdmin: boolean
  status: string
  createdAt: string
  updatedAt: string
}

export interface PublicProfile {
  id: string
  displayName: string
  avatarKey: string | null
}

function mapProfile(r: UserRow): UserProfile {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    avatarKey: r.avatar_key,
    emailVerifiedAt: r.email_verified_at,
    isAdmin: r.is_admin,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name)

  constructor(private readonly db: RlsDbService) {}

  async getMe(userId: string): Promise<UserProfile> {
    const rows = await this.db.run({ userId }, async (tx) => {
      return tx<UserRow[]>`
        SELECT id, email, display_name, avatar_key, email_verified_at,
               is_admin, status, created_at, updated_at
        FROM   users
        WHERE  id = ${userId}
      `
    })
    if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
    return mapProfile(rows[0])
  }

  async updateMe(userId: string, input: UpdateProfileInput): Promise<UserProfile> {
    return this.db.run({ userId }, async (tx) => {
      // Fetch current values to support partial update
      const current = await tx<{ display_name: string; avatar_key: string | null }[]>`
        SELECT display_name, avatar_key FROM users WHERE id = ${userId}
      `
      if (!current[0]) throw new NotFoundException({ code: 'not_found' })

      const newDisplayName = input.displayName ?? current[0].display_name
      const newAvatarKey =
        input.avatarKey !== undefined ? input.avatarKey : current[0].avatar_key

      const rows = await tx<UserRow[]>`
        UPDATE users
        SET    display_name = ${newDisplayName},
               avatar_key   = ${newAvatarKey},
               updated_at   = now()
        WHERE  id = ${userId}
        RETURNING id, email, display_name, avatar_key, email_verified_at,
                  is_admin, status, created_at, updated_at
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      this.logger.log({
        event: 'user.profile_updated',
        actorId: userId,
        targetId: userId,
        action: 'update',
      })
      return mapProfile(rows[0])
    })
  }

  async getPublicProfile(actorId: string, targetId: string): Promise<PublicProfile> {
    const rows = await this.db.run({ userId: actorId }, async (tx) => {
      return tx<{ id: string; display_name: string; avatar_key: string | null }[]>`
        SELECT id, display_name, avatar_key FROM users WHERE id = ${targetId}
      `
    })
    if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
    return {
      id: rows[0].id,
      displayName: rows[0].display_name,
      avatarKey: rows[0].avatar_key,
    }
  }
}
