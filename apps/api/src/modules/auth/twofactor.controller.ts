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
} from '@nestjs/common'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { JwtAuthGuard } from './guards/jwt-auth.guard.js'
import { CurrentUser, type AuthenticatedUser } from './decorators/current-user.decorator.js'
import { SessionService } from './session.service.js'
import { TwoFactorService } from './twofactor.service.js'
import { TotpChallengeDto } from './dto/totp-challenge.dto.js'
import { TotpConfirmDto } from './dto/totp-confirm.dto.js'
import { TotpDisableDto } from './dto/totp-disable.dto.js'

@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly session: SessionService,
  ) {}

  /**
   * POST /auth/2fa/enroll
   * Start enrollment: generate secret, return QR URI and a signed pending token.
   * Requires a valid access token (JwtAuthGuard).
   */
  @Post('enroll')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async enroll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ totpUri: string; pendingToken: string }> {
    const { totpUri, pendingToken } = await this.twoFactor.enroll(user.userId)
    return { totpUri, pendingToken }
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
    const { recoveryCodes } = await this.twoFactor.confirmEnrollment(
      user.userId,
      body.pendingToken,
      body.code,
    )

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

    reply.header('Set-Cookie', [
      this.session.buildRefreshCookieHeader(rawRefreshToken),
      this.session.buildAccessCookieHeader(accessToken, expiresIn),
    ])
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
