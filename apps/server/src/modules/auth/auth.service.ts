import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import * as argon2 from 'argon2';
import { eq, and, gt } from 'drizzle-orm';
import { getDb } from '@bramha/db';
import { users, sessions } from '@bramha/db';
import type { RegisterInput, LoginInput } from '@bramha/shared';

const require = createRequire(import.meta.url);
 
const zxcvbn: (password: string) => { score: number } = require('zxcvbn');

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SLIDE_THRESHOLD_MS = 3.5 * 24 * 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

@Injectable()
export class AuthService {
  async register(dto: RegisterInput): Promise<void> {
    const email = dto.email.toLowerCase().trim();

    // timing: always evaluate password strength and hash even if email exists
    if (zxcvbn(dto.password).score < 3) {
      throw new BadRequestException({
        type: 'about:blank',
        title: 'Weak password',
        status: 400,
        detail: 'Password is too weak. Choose a stronger password.',
        code: 'WEAK_PASSWORD',
      });
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);

    const db = await getDb();

    // timing: attempt insert; swallow conflict silently (enumeration prevention)
    try {
      await db.insert(users).values({
        email,
        name: dto.name,
        passwordHash,
        emailVerifiedAt: new Date(),
      });
    } catch {
      // timing: hash already computed above — no extra work needed here
      // Silently swallow duplicate email; do NOT expose 409 or any distinguishing error
    }
  }

  async login(dto: LoginInput): Promise<string> {
    const email = dto.email.toLowerCase().trim();
    const db = await getDb();

    const [user] = await db.select().from(users).where(eq(users.email, email));

    // timing: always hash even when user not found to prevent timing attacks
    const hashToVerify = user?.passwordHash ?? '$argon2id$v=19$m=19456,t=2,p=1$dummy$dummy';
    let passwordOk = false;
    try {
      passwordOk = await argon2.verify(hashToVerify, dto.password);
    } catch {
      passwordOk = false;
    }

    if (!user || !passwordOk) {
      throw new UnauthorizedException({
        type: 'about:blank',
        title: 'Invalid credentials',
        status: 401,
        code: 'INVALID_CREDENTIALS',
      });
    }

    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);

    await db.insert(sessions).values({
      userId: user.id,
      tokenHash,
      expiresAt: sessionExpiry(),
    });

    return rawToken;
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  async validateSession(rawToken: string): Promise<{ id: string; email: string; name: string }> {
    const tokenHash = hashToken(rawToken);
    const db = await getDb();
    const now = new Date();

    const [row] = await db
      .select({
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
        email: users.email,
        name: users.name,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)));

    if (!row) {
      throw new UnauthorizedException({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        code: 'UNAUTHORIZED',
      });
    }

    // Sliding expiry: if session expires within 3.5 days, extend to 7 days from now
    if (row.expiresAt.getTime() - now.getTime() < SLIDE_THRESHOLD_MS) {
      await db
        .update(sessions)
        .set({ expiresAt: sessionExpiry() })
        .where(eq(sessions.tokenHash, tokenHash));
    }

    return { id: row.userId, email: row.email, name: row.name };
  }
}
