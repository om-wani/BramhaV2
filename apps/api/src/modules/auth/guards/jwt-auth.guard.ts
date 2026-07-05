import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { JwtService } from '../jwt.service'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: { userId: string } }>()

    const authHeader = request.headers['authorization']
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'invalid_token',
        message: 'Missing authorization header',
      })
    }

    const token = authHeader.slice(7) // strip "Bearer "
    const payload = await this.jwt.verify(token) // throws UnauthorizedException on failure

    request.user = { userId: payload.userId }
    return true
  }
}
