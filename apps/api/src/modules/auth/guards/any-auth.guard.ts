import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common'
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
      return (await this.jwt.canActivate(context)) as boolean
    } catch {
      return (await this.apiKey.canActivate(context)) as boolean
    }
  }
}
