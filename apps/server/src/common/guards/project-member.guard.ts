import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  mixin,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ProjectsService } from '../../modules/projects/projects.service.js';

type AuthenticatedRequest = FastifyRequest & {
  user: { id: string; email: string; name: string };
  params: Record<string, string>;
};

export function ProjectMemberGuard(requiredRole: 'admin' | 'member') {
  @Injectable()
  class Guard implements CanActivate {
    constructor(readonly projectsService: ProjectsService) {}

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
      const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
      const projectId = req.params['projectId'];
      const userId = req.user.id;

      if (!projectId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
      }

      const role = await this.projectsService.getMemberRole(projectId, userId);

      if (!role) {
        throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
      }

      if (requiredRole === 'admin' && role !== 'admin') {
        throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
      }

      return true;
    }
  }

  return mixin(Guard);
}
