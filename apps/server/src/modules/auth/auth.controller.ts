import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RegisterSchema, LoginSchema } from '@bramha/shared';
import type { RegisterInput, LoginInput } from '@bramha/shared';

const COOKIE_NAME = 'bramha_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(201)
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: RegisterInput,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    // Enumeration prevention: ALWAYS return 201 even if email already exists.
    // authService.register() swallows duplicate errors silently.
    // On success, auto-login and set session cookie.
    // HttpExceptions (validation, weak password) propagate normally.
    // authService.register() itself swallows duplicate-email DB errors.
    await this.authService.register(body);

    // Auto-login after successful registration; swallow unexpected login errors silently.
    try {
      const rawToken = await this.authService.login({
        email: body.email,
        password: body.password,
      });
      res.setCookie(COOKIE_NAME, rawToken, {
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: COOKIE_MAX_AGE,
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Swallow unexpected auto-login failures — registration itself succeeded
    }
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<{ userId: string }> {
    const rawToken = await this.authService.login(body);

    // Resolve userId by validating the just-created session
    const user = await this.authService.validateSession(rawToken);

    res.setCookie(COOKIE_NAME, rawToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE,
    });

    return { userId: user.id };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async me(
    @Req() req: FastifyRequest,
  ): Promise<{ id: string; email: string; name: string; isAdmin: boolean }> {
    return (req as FastifyRequest & { user: { id: string; email: string; name: string; isAdmin: boolean } }).user;
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    const rawToken = (req.cookies as Record<string, string | undefined>)[COOKIE_NAME];
    if (rawToken) {
      await this.authService.logout(rawToken);
    }
    res.setCookie(COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  }
}
