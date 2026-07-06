import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common'
import { ApiKeysService } from '../api-keys.service'
import { ErrorCodes } from '@bramha/shared'

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>
      user?: unknown
    }>()
    const auth: string | undefined = req.headers['authorization']

    // Non-API-key bearer tokens are handled by JwtAuthGuard
    if (!auth?.startsWith('Bearer bmv2_')) return false

    const rawKey = auth.slice('Bearer '.length)
    const result = await this.apiKeys.validateKey(rawKey)
    if (!result) throw new UnauthorizedException({ code: ErrorCodes.API_KEY_INVALID })

    req.user = { userId: result.userId, apiKeyId: result.keyId, scopes: result.scopes }
    return true
  }
}
