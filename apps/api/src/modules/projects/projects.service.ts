import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException, Logger } from '@nestjs/common'
import { RlsDbService } from '../common/db/rls-db.service.js'
import type {
  CreateProjectInput,
  UpdateProjectInput,
  AddProjectMemberInput,
  UpdateProjectMemberRoleInput,
} from '@bramha/shared'

interface ProjectRow {
  id: string
  org_id: string
  name: string
  description: string | null
  settings: unknown
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface ProjectDto {
  id: string
  orgId: string
  name: string
  description: string | null
  settings: unknown
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectMemberDto {
  projectId: string
  userId: string
  role: string
  createdAt: string
}

function mapProject(r: ProjectRow): ProjectDto {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    description: r.description,
    settings: r.settings,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name)

  constructor(private readonly db: RlsDbService) {}

  // ── Projects ───────────────────────────────────────────────────────────

  async create(userId: string, orgId: string, input: CreateProjectInput): Promise<ProjectDto> {
    return this.db.run({ userId }, async (tx) => {
      const rows = await tx<ProjectRow[]>`
        INSERT INTO projects (org_id, name, description)
        VALUES (${orgId}, ${input.name}, ${input.description ?? null})
        RETURNING id, org_id, name, description, settings, archived_at, created_at, updated_at
      `
      if (!rows[0]) throw new Error('project insert returned no row')
      await tx`
        INSERT INTO project_members (project_id, user_id, role)
        VALUES (${rows[0].id}, ${userId}, 'owner')
      `
      this.logger.log({
        event: 'project.created',
        actorId: userId,
        targetId: rows[0].id,
        action: 'create',
      })
      return mapProject(rows[0])
    })
  }

  async listByOrg(userId: string, orgId: string): Promise<ProjectDto[]> {
    return this.db.run({ userId }, async (tx) => {
      const rows = await tx<ProjectRow[]>`
        SELECT p.id, p.org_id, p.name, p.description, p.settings, p.archived_at,
               p.created_at, p.updated_at
        FROM   projects p
        JOIN   project_members pm ON pm.project_id = p.id
        WHERE  p.org_id = ${orgId} AND pm.user_id = ${userId}
        ORDER  BY p.created_at ASC
      `
      return rows.map(mapProject)
    })
  }

  async getById(userId: string, projectId: string): Promise<ProjectDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const rows = await tx<ProjectRow[]>`
        SELECT p.id, p.org_id, p.name, p.description, p.settings, p.archived_at,
               p.created_at, p.updated_at
        FROM   projects p
        JOIN   project_members pm ON pm.project_id = p.id
        WHERE  p.id = ${projectId} AND pm.user_id = ${userId}
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      return mapProject(rows[0])
    })
  }

  async update(userId: string, projectId: string, input: UpdateProjectInput): Promise<ProjectDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      // Verify ownership
      const membership = await tx<{ role: string }[]>`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}
      `
      if (!membership[0]) throw new NotFoundException({ code: 'not_found' })
      if (membership[0].role !== 'owner') throw new ForbiddenException({ code: 'forbidden' })

      const current = await tx<{ name: string; description: string | null }[]>`
        SELECT name, description FROM projects WHERE id = ${projectId}
      `
      if (!current[0]) throw new NotFoundException({ code: 'not_found' })

      const newName = input.name ?? current[0].name
      const newDescription =
        input.description !== undefined ? input.description : current[0].description

      let rows: ProjectRow[]
      if (input.settings !== undefined) {
        rows = await tx<ProjectRow[]>`
          UPDATE projects
          SET    name        = ${newName},
                 description = ${newDescription},
                 settings    = settings || ${JSON.stringify(input.settings)}::jsonb,
                 updated_at  = now()
          WHERE  id = ${projectId}
          RETURNING id, org_id, name, description, settings, archived_at, created_at, updated_at
        `
      } else {
        rows = await tx<ProjectRow[]>`
          UPDATE projects
          SET    name        = ${newName},
                 description = ${newDescription},
                 updated_at  = now()
          WHERE  id = ${projectId}
          RETURNING id, org_id, name, description, settings, archived_at, created_at, updated_at
        `
      }
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      this.logger.log({
        event: 'project.updated',
        actorId: userId,
        targetId: projectId,
        action: 'update',
      })
      return mapProject(rows[0])
    })
  }

  async archive(userId: string, projectId: string): Promise<ProjectDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const membership = await tx<{ role: string }[]>`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}
      `
      if (!membership[0]) throw new NotFoundException({ code: 'not_found' })
      if (membership[0].role !== 'owner') throw new ForbiddenException({ code: 'forbidden' })

      const rows = await tx<ProjectRow[]>`
        UPDATE projects
        SET    archived_at = now(),
               updated_at  = now()
        WHERE  id = ${projectId}
        RETURNING id, org_id, name, description, settings, archived_at, created_at, updated_at
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      this.logger.log({
        event: 'project.archived',
        actorId: userId,
        targetId: projectId,
        action: 'archive',
      })
      return mapProject(rows[0])
    })
  }

  // ── Project Members ────────────────────────────────────────────────────

  async addMember(
    actorId: string,
    projectId: string,
    input: AddProjectMemberInput,
  ): Promise<ProjectMemberDto> {
    return this.db.run({ userId: actorId, projectId }, async (tx) => {
      // Get project to check org_id
      const projectRows = await tx<{ org_id: string }[]>`
        SELECT org_id FROM projects WHERE id = ${projectId}
      `
      if (!projectRows[0]) throw new NotFoundException({ code: 'not_found' })
      const project = projectRows[0]

      // Check target user is an org member (must join org before project)
      const orgMember = await tx`
        SELECT 1 FROM org_members WHERE org_id = ${project.org_id} AND user_id = ${input.userId}
      `
      if (!orgMember[0]) {
        throw new BadRequestException({ code: 'not_org_member', message: 'User must be an org member first' })
      }

      // Check not already a project member
      const existing = await tx`
        SELECT 1 FROM project_members WHERE project_id = ${projectId} AND user_id = ${input.userId}
      `
      if (existing[0]) {
        throw new ConflictException({ code: 'already_member', message: 'User is already a project member' })
      }

      const rows = await tx<{
        project_id: string
        user_id: string
        role: string
        created_at: string
      }[]>`
        INSERT INTO project_members (project_id, user_id, role)
        VALUES (${projectId}, ${input.userId}, ${input.role})
        RETURNING project_id, user_id, role, created_at
      `
      if (!rows[0]) throw new Error('project_member insert returned no row')
      this.logger.log({
        event: 'project.member_added',
        actorId,
        targetId: input.userId,
        action: 'add_member',
      })
      return {
        projectId: rows[0].project_id,
        userId: rows[0].user_id,
        role: rows[0].role,
        createdAt: rows[0].created_at,
      }
    })
  }

  async listMembers(userId: string, projectId: string): Promise<ProjectMemberDto[]> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const rows = await tx<{
        project_id: string
        user_id: string
        role: string
        created_at: string
      }[]>`
        SELECT project_id, user_id, role, created_at
        FROM   project_members
        WHERE  project_id = ${projectId}
        ORDER  BY created_at ASC
      `
      return rows.map((r) => ({
        projectId: r.project_id,
        userId: r.user_id,
        role: r.role,
        createdAt: r.created_at,
      }))
    })
  }

  async updateMemberRole(
    actorId: string,
    projectId: string,
    targetUserId: string,
    input: UpdateProjectMemberRoleInput,
  ): Promise<void> {
    return this.db.run({ userId: actorId, projectId }, async (tx) => {
      const actorMembership = await tx<{ role: string }[]>`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${actorId}
      `
      if (!actorMembership[0]) throw new NotFoundException({ code: 'not_found' })
      if (actorMembership[0].role !== 'owner') throw new ForbiddenException({ code: 'forbidden' })

      // Guard: cannot demote the last owner
      const currentMembership = await tx<{ role: string }[]>`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${targetUserId} LIMIT 1
      `
      if (currentMembership[0]?.role === 'owner' && input.role !== 'owner') {
        const ownerCount = await tx<{ cnt: string }[]>`
          SELECT COUNT(*) AS cnt FROM project_members WHERE project_id = ${projectId} AND role = 'owner'
        `
        if (Number(ownerCount[0]?.cnt ?? 0) <= 1) {
          throw new ForbiddenException({ code: 'last_owner', message: 'Cannot demote the last owner' })
        }
      }

      await tx`
        UPDATE project_members
        SET    role = ${input.role}
        WHERE  project_id = ${projectId} AND user_id = ${targetUserId}
      `
      this.logger.log({
        event: 'project.member_role_updated',
        actorId,
        targetId: targetUserId,
        action: 'update_role',
      })
    })
  }

  async removeMember(actorId: string, projectId: string, targetUserId: string): Promise<void> {
    return this.db.run({ userId: actorId, projectId }, async (tx) => {
      const actorMembership = await tx<{ role: string }[]>`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${actorId}
      `
      if (!actorMembership[0]) throw new NotFoundException({ code: 'not_found' })
      if (actorMembership[0].role !== 'owner') throw new ForbiddenException({ code: 'forbidden' })

      // Guard: cannot remove last owner.
      // Check target's role first; if owner, verify there is more than one owner remaining.
      const targetMembership = await tx<{ role: string }[]>`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${targetUserId}
      `
      if (targetMembership[0]?.role === 'owner') {
        const countRows = await tx<{ count: string }[]>`
          SELECT count(*)::text AS count
          FROM   project_members
          WHERE  project_id = ${projectId} AND role = 'owner'
        `
        const ownerCount = parseInt(countRows[0]?.count ?? '0', 10)
        if (ownerCount <= 1) {
          throw new ForbiddenException({ code: 'last_owner' })
        }
      }

      await tx`
        DELETE FROM project_members WHERE project_id = ${projectId} AND user_id = ${targetUserId}
      `
      this.logger.log({
        event: 'project.member_removed',
        actorId,
        targetId: targetUserId,
        action: 'remove',
      })
    })
  }
}
