import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canActivate(_ctx: ExecutionContext): boolean {
    // TODO P1.1: validate session cookie against sessions table
    // Must throw UnauthorizedException (not return false) when auth fails
    throw new UnauthorizedException({ code: 'UNAUTHORIZED', title: 'Unauthorized' });
  }
}
