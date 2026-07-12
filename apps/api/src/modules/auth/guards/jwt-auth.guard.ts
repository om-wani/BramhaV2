import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { JwtService } from '../jwt.service.js'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: { userId: string; twoFactorVerified: boolean } }>()

    const authHeader = request.headers['authorization']
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'invalid_token',
        message: 'Missing authorization header',
      })
    }

    const token = authHeader.slice(7) // strip "Bearer "

    // Decode header to detect pre_auth tokens before full verify
    // (pre_auth tokens embed a `type` claim in the payload)
    const parts = token.split('.')
    if (parts.length >= 2 && parts[1]) {
      try {
        const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8')
        const parsed = JSON.parse(payloadJson) as Record<string, unknown>
        if (parsed['type'] === 'pre_auth') {
          throw new UnauthorizedException({ code: 'invalid_token', message: 'Invalid token' })
        }
      } catch (e) {
        if (e instanceof UnauthorizedException) throw e
        // Malformed — let verify() reject it below
      }
    }

    const payload = await this.jwt.verify(token) // throws UnauthorizedException on failure

    request.user = { userId: payload.userId, twoFactorVerified: payload.twoFactorVerified }
    return true
  }
}
