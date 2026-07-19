import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';

@Injectable()
export class ProjectMemberGuard implements CanActivate {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canActivate(_ctx: ExecutionContext): boolean {
    // TODO P1+: validate project membership from session + route params
    // Must throw ForbiddenException (not return false) when access denied
    throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
  }
}
