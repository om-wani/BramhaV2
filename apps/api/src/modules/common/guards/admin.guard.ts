import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { RlsDbService } from '../db/rls-db.service.js'

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly db: RlsDbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: { userId: string; twoFactorVerified?: boolean } }>()
    const userId = req.user?.userId
    if (!userId) throw new ForbiddenException({ code: 'forbidden' })

    const rows = await this.db.run({ userId }, async (tx) => {
      return tx<{ is_admin: boolean; totp_enabled: boolean }[]>`
        SELECT is_admin, (totp_secret_enc IS NOT NULL) AS totp_enabled
        FROM users WHERE id = ${userId}
      `
    })

    if (!rows[0]?.is_admin) throw new ForbiddenException({ code: 'admin_required' })

    // If the admin has TOTP configured, they must have completed 2FA in this session
    if (rows[0].totp_enabled && !req.user?.twoFactorVerified) {
      throw new ForbiddenException({ code: 'admin_requires_2fa' })
    }

    return true
  }
}
