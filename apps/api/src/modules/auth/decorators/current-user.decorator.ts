import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'

export interface AuthenticatedUser {
  userId: string
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthenticatedUser }>()
    if (!request.user) {
      throw new Error('CurrentUser decorator used outside of JwtAuthGuard context')
    }
    return request.user
  },
)
