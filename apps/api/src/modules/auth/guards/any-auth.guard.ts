import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common'
import { JwtAuthGuard } from './jwt-auth.guard'
import { ApiKeyGuard } from '../../users/api-keys/guards/api-key.guard'

@Injectable()
export class AnyAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtAuthGuard,
    private readonly apiKey: ApiKeyGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await this.jwt.canActivate(context) as boolean
    } catch (e) {
      // Only swallow auth failures — rethrow unexpected errors
      if (!(e instanceof UnauthorizedException) && !(e instanceof ForbiddenException)) {
        throw e
      }
    }
    const result = await this.apiKey.canActivate(context)
    if (!result) {
      throw new UnauthorizedException({ code: 'token_missing' })
    }
    return true
  }
}
