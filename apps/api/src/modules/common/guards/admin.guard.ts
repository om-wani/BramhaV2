import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { RlsDbService } from '../db/rls-db.service'

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly db: RlsDbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: { userId: string } }>()
    const userId = req.user?.userId
    if (!userId) throw new ForbiddenException({ code: 'forbidden' })

    const rows = await this.db.run({ userId }, async (tx) => {
      return tx<{ is_admin: boolean }[]>`
        SELECT is_admin FROM users WHERE id = ${userId}
      `
    })

    if (!rows[0]?.is_admin) throw new ForbiddenException({ code: 'forbidden' })
    return true
  }
}
