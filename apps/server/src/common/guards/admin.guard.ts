import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/**
 * Gate for godmode endpoints. Must run AFTER SessionAuthGuard, which attaches
 * req.user (including isAdmin) from the validated session.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: { isAdmin?: boolean } }>();
    if (!req.user?.isAdmin) {
      throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Admin only' });
    }
    return true;
  }
}
