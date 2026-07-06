import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { AuthService } from './auth.service'
import { SessionService } from './session.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { AnyAuthGuard } from './guards/any-auth.guard'
import { CurrentUser, type AuthenticatedUser } from './decorators/current-user.decorator'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { VerifyEmailDto } from './dto/verify-email.dto'
import { ForgotPasswordDto } from './dto/forgot-password.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'

/** Parse a raw Cookie header into a key→value map. */
function parseCookies(cookieHeader?: string | string[]): Record<string, string> {
  const header = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader
  if (!header) return {}
  const result: Record<string, string> = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) result[key] = value
  }
  return result
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
  ) {}

  /** POST /auth/register — create account and send verification email */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() body: RegisterDto): Promise<{ userId: string; message: string }> {
    const { userId } = await this.authService.register(body)
    return {
      userId,
      message: 'Account created. Check your email for a verification link.',
    }
  }

  /** POST /auth/verify — verify email with token */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() body: VerifyEmailDto): Promise<{ message: string }> {
    await this.authService.verifyEmail(body.token)
    return { message: 'Email verified successfully' }
  }

  /** POST /auth/login — authenticate and return access token + set refresh cookie, or pre-auth token if 2FA is enabled */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<
    | { accessToken: string; expiresIn: number }
    | { requiresTwoFactor: true; preAuthToken: string }
  > {
    const ip = req.ip ?? null
    const userAgent = (req.headers['user-agent'] as string | undefined) ?? null
    const result = await this.authService.login(body, ip, userAgent)

    if (result.requiresTwoFactor) {
      return { requiresTwoFactor: true, preAuthToken: result.preAuthToken }
    }

    reply.header('Set-Cookie', this.sessionService.buildRefreshCookieHeader(result.rawRefreshToken))
    return { accessToken: result.accessToken, expiresIn: result.expiresIn }
  }

  /** POST /auth/refresh — rotate refresh token, return new access token */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const cookies = parseCookies(req.headers['cookie'])
    const rawRefreshToken = cookies['refresh_token']

    if (!rawRefreshToken) {
      throw new UnauthorizedException({ code: 'token_invalid', message: 'Missing refresh token' })
    }

    const ip = req.ip ?? null
    const userAgent = (req.headers['user-agent'] as string | undefined) ?? null
    const { accessToken, expiresIn, rawRefreshToken: newRawToken } =
      await this.authService.refresh(rawRefreshToken, ip, userAgent)

    reply.header('Set-Cookie', this.sessionService.buildRefreshCookieHeader(newRawToken))
    return { accessToken, expiresIn }
  }

  /** POST /auth/logout — revoke session and clear cookie */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const cookies = parseCookies(req.headers['cookie'])
    const rawRefreshToken = cookies['refresh_token'] ?? ''
    await this.authService.logout(rawRefreshToken, user.userId)
    reply.header('Set-Cookie', this.sessionService.buildClearRefreshCookieHeader())
  }

  /** POST /auth/forgot-password — request a password reset link */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<{ message: string }> {
    await this.authService.forgotPassword(body.email)
    return { message: 'If an account exists, a reset link has been sent.' }
  }

  /** POST /auth/reset-password — reset password using a valid reset token */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() body: ResetPasswordDto): Promise<{ message: string }> {
    await this.authService.resetPassword(body.token, body.password)
    return { message: 'Password reset successfully.' }
  }

  /** GET /auth/me — return current authenticated user (accepts JWT or API key) */
  @Get('me')
  @UseGuards(AnyAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<{
    id: string
    email: string
    displayName: string
    emailVerifiedAt: string | null
    avatarKey: null
    isAdmin: boolean
    status: string
    createdAt: string
    updatedAt: string
  }> {
    return this.authService.getMe(user.userId)
  }
}
