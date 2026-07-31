import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { verifyUploadTicket } from './upload-ticket.js';

// Authorizes a direct file upload via a Bearer upload ticket (see
// upload-ticket.ts). The ticket already encodes a validated admin membership
// for the project, so no cookie/session or extra membership check is needed.
@Injectable()
export class UploadTicketGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<
      FastifyRequest & { user?: { id: string }; params: Record<string, string> }
    >();

    const auth = req.headers['authorization'];
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const projectId = req.params?.['projectId'];

    if (!token || !projectId) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', title: 'Unauthorized' });
    }
    const result = verifyUploadTicket(token, projectId);
    if (!result) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', title: 'Invalid upload ticket' });
    }
    req.user = { id: result.userId };
    return true;
  }
}
