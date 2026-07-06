import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  mixin,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { RlsDbService } from '../db/rls-db.service'
import type { ProjectRole } from '@bramha/shared'

const PROJECT_ROLE_ORDER: ProjectRole[] = ['viewer', 'editor', 'owner']

function hasProjectRole(actual: ProjectRole, required: ProjectRole): boolean {
  return PROJECT_ROLE_ORDER.indexOf(actual) >= PROJECT_ROLE_ORDER.indexOf(required)
}

function createProjectMemberGuard(requiredRole: ProjectRole) {
  @Injectable()
  class ProjectMixinGuard implements CanActivate {
    constructor(readonly db: RlsDbService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const req = context
        .switchToHttp()
        .getRequest<
          FastifyRequest & { user?: { userId: string }; params: Record<string, string> }
        >()
      const userId = req.user?.userId
      const projectId = req.params['projectId']
      if (!userId || !projectId) throw new ForbiddenException({ code: 'forbidden' })

      const rows = await this.db.run({ userId, projectId }, async (tx) => {
        return tx<{ role: string }[]>`
          SELECT role FROM project_members
          WHERE project_id = ${projectId} AND user_id = ${userId}
        `
      })

      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      if (!hasProjectRole(rows[0].role as ProjectRole, requiredRole)) {
        throw new ForbiddenException({ code: 'forbidden' })
      }
      return true
    }
  }

  return mixin(ProjectMixinGuard)
}

// Exported concrete guard classes — use these in @UseGuards() and module providers
export const ProjectViewerGuard = createProjectMemberGuard('viewer')
export const ProjectEditorGuard = createProjectMemberGuard('editor')
export const ProjectOwnerGuard = createProjectMemberGuard('owner')
