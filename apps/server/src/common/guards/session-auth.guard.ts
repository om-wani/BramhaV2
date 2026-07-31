import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthService } from '../../modules/auth/auth.service.js';

type AuthenticatedRequest = FastifyRequest & {
  user: { id: string; email: string; name: string | null; isAdmin: boolean };
};

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const rawToken = (req.cookies as Record<string, string | undefined>)['bramha_session'];

    if (!rawToken) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', title: 'Unauthorized' });
    }

    const user = await this.authService.validateSession(rawToken);
    (req as AuthenticatedRequest).user = user;
    return true;
  }
}
