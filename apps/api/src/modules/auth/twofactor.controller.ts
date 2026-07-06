import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { CurrentUser, type AuthenticatedUser } from './decorators/current-user.decorator'
import { SessionService } from './session.service'
import { TwoFactorService } from './twofactor.service'
import { TotpChallengeDto } from './dto/totp-challenge.dto'
import { TotpConfirmDto } from './dto/totp-confirm.dto'
import { TotpDisableDto } from './dto/totp-disable.dto'

/**
 * In-process store of pending enrollment secrets keyed by userId.
 * Cleared once enrollment is confirmed or after a short TTL (enforced via the
 * pre-auth flow — the user must confirm within their session's lifetime).
 */
const pendingSecrets = new Map<string, { secret: string; expiresAt: number }>()
const PENDING_TTL_MS = 10 * 60 * 1000 // 10 minutes to complete enrollment

@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly session: SessionService,
  ) {}

  /**
   * POST /auth/2fa/enroll
   * Start enrollment: generate secret, return QR URI.
   * Requires a valid access token (JwtAuthGuard).
   */
  @Post('enroll')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async enroll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ totpUri: string }> {
    const { totpUri, pendingSecret } = await this.twoFactor.enroll(user.userId)

    // Store pending secret server-side keyed by userId
    pendingSecrets.set(user.userId, {
      secret: pendingSecret,
      expiresAt: Date.now() + PENDING_TTL_MS,
    })

    // Return only the URI — never return the raw secret to the client
    return { totpUri }
  }

  /**
   * POST /auth/2fa/confirm
   * Confirm enrollment with first valid TOTP code.
   * Requires a valid access token (JwtAuthGuard).
   */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TotpConfirmDto,
  ): Promise<{ message: string; recoveryCodes: string[] }> {
    const pending = pendingSecrets.get(user.userId)
    if (!pending || Date.now() > pending.expiresAt) {
      pendingSecrets.delete(user.userId)
      throw new UnauthorizedException({
        code: 'totp_invalid',
        message: 'No pending 2FA enrollment found or enrollment expired. Call /auth/2fa/enroll first.',
      })
    }

    const { recoveryCodes } = await this.twoFactor.confirmEnrollment(
      user.userId,
      pending.secret,
      body.code,
    )

    // Remove pending secret — enrollment is complete
    pendingSecrets.delete(user.userId)

    return {
      message: '2FA enabled successfully. Store your recovery codes safely — they will not be shown again.',
      recoveryCodes,
    }
  }

  /**
   * DELETE /auth/2fa/disable
   * Disable 2FA. Requires a valid TOTP code or recovery code.
   * Requires a valid access token (JwtAuthGuard).
   */
  @Delete('disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async disable(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TotpDisableDto,
  ): Promise<{ message: string }> {
    await this.twoFactor.disable(user.userId, body.code)
    pendingSecrets.delete(user.userId) // clean up any pending state
    return { message: '2FA has been disabled' }
  }

  /**
   * POST /auth/2fa/challenge
   * Complete login for 2FA-enabled accounts.
   * No auth guard — accepts pre-auth token in body.
   */
  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  async challenge(
    @Body() body: TotpChallengeDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const ip = req.ip ?? null
    const userAgent = (req.headers['user-agent'] as string | undefined) ?? null

    const { accessToken, expiresIn, rawRefreshToken } = await this.twoFactor.challenge(
      body.preAuthToken,
      body.code,
      ip,
      userAgent,
    )

    reply.header('Set-Cookie', this.session.buildRefreshCookieHeader(rawRefreshToken))
    return { accessToken, expiresIn }
  }

  /**
   * GET /auth/2fa/recovery
   * Returns the count of remaining (unused) recovery codes.
   * Requires a valid access token (JwtAuthGuard).
   */
  @Get('recovery')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async recoveryStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ codesRemaining: number }> {
    return this.twoFactor.getRecoveryStatus(user.userId)
  }
}
