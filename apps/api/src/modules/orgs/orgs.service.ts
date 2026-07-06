import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common'
import { RlsDbService } from '../common/db/rls-db.service'
import type {
  CreateOrgInput,
  UpdateOrgInput,
  InviteOrgMemberInput,
  OrgRole,
} from '@bramha/shared'

interface OrgRow {
  id: string
  name: string
  slug: string
  owner_id: string
  created_at: string
  updated_at: string
}

export interface OrgDto {
  id: string
  name: string
  slug: string
  ownerId: string
  createdAt: string
  updatedAt: string
}

export interface OrgMemberDto {
  orgId: string
  userId: string
  role: string
  createdAt: string
}

function mapOrg(r: OrgRow): OrgDto {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    ownerId: r.owner_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

@Injectable()
export class OrgsService {
  private readonly logger = new Logger(OrgsService.name)

  constructor(private readonly db: RlsDbService) {}

  // ── Orgs ───────────────────────────────────────────────────────────────

  async create(userId: string, input: CreateOrgInput): Promise<OrgDto> {
    return this.db.run({ userId }, async (tx) => {
      let rows: OrgRow[]
      try {
        rows = await tx<OrgRow[]>`
          INSERT INTO orgs (name, slug, owner_id)
          VALUES (${input.name}, ${input.slug}, ${userId})
          RETURNING id, name, slug, owner_id, created_at, updated_at
        `
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : ''
        if (msg.includes('unique') && msg.includes('slug')) {
          throw new ConflictException({ code: 'slug_taken' })
        }
        throw err
      }
      if (!rows[0]) throw new Error('org insert returned no row')
      await tx`
        INSERT INTO org_members (org_id, user_id, role)
        VALUES (${rows[0].id}, ${userId}, 'owner')
      `
      this.logger.log({ event: 'org.created', actorId: userId, targetId: rows[0].id, action: 'create' })
      return mapOrg(rows[0])
    })
  }

  async listForUser(userId: string): Promise<OrgDto[]> {
    return this.db.run({ userId }, async (tx) => {
      const rows = await tx<OrgRow[]>`
        SELECT o.id, o.name, o.slug, o.owner_id, o.created_at, o.updated_at
        FROM   orgs o
        JOIN   org_members om ON om.org_id = o.id
        WHERE  om.user_id = ${userId}
        ORDER  BY o.created_at ASC
      `
      return rows.map(mapOrg)
    })
  }

  async getById(userId: string, orgId: string): Promise<OrgDto> {
    return this.db.run({ userId }, async (tx) => {
      const rows = await tx<OrgRow[]>`
        SELECT o.id, o.name, o.slug, o.owner_id, o.created_at, o.updated_at
        FROM   orgs o
        JOIN   org_members om ON om.org_id = o.id
        WHERE  o.id = ${orgId} AND om.user_id = ${userId}
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      return mapOrg(rows[0])
    })
  }

  async update(userId: string, orgId: string, input: UpdateOrgInput): Promise<OrgDto> {
    return this.db.run({ userId }, async (tx) => {
      const membership = await tx<{ role: string }[]>`
        SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}
      `
      if (!membership[0]) throw new NotFoundException({ code: 'not_found' })
      if (membership[0].role !== 'owner') throw new ForbiddenException({ code: 'forbidden' })

      const current = await tx<{ name: string; slug: string }[]>`
        SELECT name, slug FROM orgs WHERE id = ${orgId}
      `
      if (!current[0]) throw new NotFoundException({ code: 'not_found' })

      const rows = await tx<OrgRow[]>`
        UPDATE orgs
        SET    name       = ${input.name ?? current[0].name},
               slug       = ${input.slug ?? current[0].slug},
               updated_at = now()
        WHERE  id = ${orgId}
        RETURNING id, name, slug, owner_id, created_at, updated_at
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      this.logger.log({ event: 'org.updated', actorId: userId, targetId: orgId, action: 'update' })
      return mapOrg(rows[0])
    })
  }

  async deleteOrg(userId: string, orgId: string): Promise<void> {
    return this.db.run({ userId }, async (tx) => {
      const membership = await tx<{ role: string }[]>`
        SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}
      `
      if (!membership[0]) throw new NotFoundException({ code: 'not_found' })
      if (membership[0].role !== 'owner') throw new ForbiddenException({ code: 'forbidden' })

      await tx`DELETE FROM orgs WHERE id = ${orgId}`
      this.logger.log({ event: 'org.deleted', actorId: userId, targetId: orgId, action: 'delete' })
    })
  }

  // ── Org Members ────────────────────────────────────────────────────────

  async inviteMember(
    actorId: string,
    orgId: string,
    input: InviteOrgMemberInput,
  ): Promise<OrgMemberDto> {
    return this.db.run({ userId: actorId }, async (tx) => {
      // Find user by email
      const users = await tx<{ id: string }[]>`
        SELECT id FROM users WHERE email = ${input.email}
      `
      if (!users[0]) throw new NotFoundException({ code: 'user_not_found' })
      const targetUserId = users[0].id

      // Check not already a member
      const existing = await tx<{ user_id: string }[]>`
        SELECT user_id FROM org_members WHERE org_id = ${orgId} AND user_id = ${targetUserId}
      `
      if (existing[0]) throw new ConflictException({ code: 'already_member' })

      const rows = await tx<{
        org_id: string
        user_id: string
        role: string
        created_at: string
      }[]>`
        INSERT INTO org_members (org_id, user_id, role)
        VALUES (${orgId}, ${targetUserId}, ${input.role})
        RETURNING org_id, user_id, role, created_at
      `
      if (!rows[0]) throw new Error('org_member insert returned no row')
      this.logger.log({
        event: 'org.member_invited',
        actorId,
        targetId: targetUserId,
        action: 'invite',
      })
      return {
        orgId: rows[0].org_id,
        userId: rows[0].user_id,
        role: rows[0].role,
        createdAt: rows[0].created_at,
      }
    })
  }

  async listMembers(userId: string, orgId: string): Promise<OrgMemberDto[]> {
    return this.db.run({ userId }, async (tx) => {
      const rows = await tx<{
        org_id: string
        user_id: string
        role: string
        created_at: string
      }[]>`
        SELECT org_id, user_id, role, created_at
        FROM   org_members
        WHERE  org_id = ${orgId}
        ORDER  BY created_at ASC
      `
      return rows.map((r) => ({
        orgId: r.org_id,
        userId: r.user_id,
        role: r.role,
        createdAt: r.created_at,
      }))
    })
  }

  async updateMemberRole(
    actorId: string,
    orgId: string,
    targetUserId: string,
    role: OrgRole,
  ): Promise<void> {
    return this.db.run({ userId: actorId }, async (tx) => {
      // Check actor's role
      const actorMembership = await tx<{ role: string }[]>`
        SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${actorId}
      `
      if (!actorMembership[0]) throw new NotFoundException({ code: 'not_found' })

      const actorRole = actorMembership[0].role as OrgRole

      // Only admin+ can change roles
      if (!['admin', 'owner'].includes(actorRole)) {
        throw new ForbiddenException({ code: 'forbidden' })
      }
      // Only owner can grant owner role
      if (role === 'owner' && actorRole !== 'owner') {
        throw new ForbiddenException({ code: 'forbidden' })
      }

      await tx`
        UPDATE org_members
        SET    role = ${role}
        WHERE  org_id = ${orgId} AND user_id = ${targetUserId}
      `
      this.logger.log({
        event: 'org.member_role_updated',
        actorId,
        targetId: targetUserId,
        action: 'update_role',
      })
    })
  }

  async removeMember(actorId: string, orgId: string, targetUserId: string): Promise<void> {
    return this.db.run({ userId: actorId }, async (tx) => {
      // Check actor's role
      const actorMembership = await tx<{ role: string }[]>`
        SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${actorId}
      `
      if (!actorMembership[0]) throw new NotFoundException({ code: 'not_found' })
      if (!['admin', 'owner'].includes(actorMembership[0].role)) {
        throw new ForbiddenException({ code: 'forbidden' })
      }

      // Guard: cannot remove last owner.
      // Check target's role first; if owner, verify there is more than one owner remaining.
      const targetMembership = await tx<{ role: string }[]>`
        SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${targetUserId}
      `
      if (targetMembership[0]?.role === 'owner') {
        const countRows = await tx<{ count: string }[]>`
          SELECT count(*)::text AS count
          FROM   org_members
          WHERE  org_id = ${orgId} AND role = 'owner'
        `
        const ownerCount = parseInt(countRows[0]?.count ?? '0', 10)
        if (ownerCount <= 1) {
          throw new ForbiddenException({ code: 'last_owner' })
        }
      }

      await tx`
        DELETE FROM org_members WHERE org_id = ${orgId} AND user_id = ${targetUserId}
      `
      this.logger.log({
        event: 'org.member_removed',
        actorId,
        targetId: targetUserId,
        action: 'remove',
      })
    })
  }
}
