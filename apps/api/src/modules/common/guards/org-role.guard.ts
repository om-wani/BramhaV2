import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  mixin,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { RlsDbService } from '../db/rls-db.service.js'
import type { OrgRole } from '@bramha/shared'

const ORG_ROLE_ORDER: OrgRole[] = ['member', 'admin', 'owner']

function hasOrgRole(actual: OrgRole, required: OrgRole): boolean {
  return ORG_ROLE_ORDER.indexOf(actual) >= ORG_ROLE_ORDER.indexOf(required)
}

function createOrgRoleGuard(requiredRole: OrgRole) {
  @Injectable()
  class OrgRoleMixinGuard implements CanActivate {
    constructor(readonly db: RlsDbService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const req = context
        .switchToHttp()
        .getRequest<
          FastifyRequest & { user?: { userId: string }; params: Record<string, string> }
        >()
      const userId = req.user?.userId
      const orgId = req.params['orgId']
      if (!userId || !orgId) throw new ForbiddenException({ code: 'forbidden' })

      const rows = await this.db.run({ userId }, async (tx) => {
        return tx<{ role: string }[]>`
          SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}
        `
      })

      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      if (!hasOrgRole(rows[0].role as OrgRole, requiredRole)) {
        throw new ForbiddenException({ code: 'forbidden' })
      }
      return true
    }
  }

  return mixin(OrgRoleMixinGuard)
}

// Exported concrete guard classes — use these in @UseGuards() and module providers
export const OrgMemberGuard = createOrgRoleGuard('member') // member or higher
export const OrgAdminGuard = createOrgRoleGuard('admin') // admin or higher
export const OrgOwnerGuard = createOrgRoleGuard('owner') // owner only
