import 'reflect-metadata';
// Use an isolated in-memory PGlite instance per test file to avoid data-dir
// contention between parallel test workers.
process.env['PGLITE_DATA_DIR'] = `memory://auth-test-${Date.now()}`;
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import fastifyCookie from '@fastify/cookie';
import { migrate } from '@bramha/db';
import { AuthModule } from '../modules/auth/auth.module.js';
import { ProblemJsonExceptionFilter } from '../common/filters/problem-json.filter.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

async function buildApp(): Promise<NestFastifyApplication> {
  await migrate();

  const module = await Test.createTestingModule({
    imports: [AuthModule],
  }).compile();

  const app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ProblemJsonExceptionFilter());
  await app.register(fastifyCookie);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

function uniqueEmail(): string {
  return `test+${Date.now()}+${Math.random().toString(36).slice(2)}@example.com`;
}

describe('Auth endpoints', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/register — success returns 201', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail(),
        name: 'Test User',
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(response.statusCode).toBe(201);
  });

  it('POST /auth/register — duplicate email ALSO returns 201 (enumeration prevention)', async () => {
    const email = uniqueEmail();
    const payload = { email, name: 'Test User', password: 'correct-horse-battery-staple' };

    const first = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(second.statusCode).toBe(201);
  });

  it('POST /auth/register — weak password returns 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail(),
        name: 'Test User',
        password: 'password',
      }),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string }>();
    expect(body.code).toBe('WEAK_PASSWORD');
  });

  it('POST /auth/login — success returns 200 with userId and sets bramha_session cookie', async () => {
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name: 'Login Test', password: 'correct-horse-battery-staple' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ userId: string }>();
    expect(typeof body.userId).toBe('string');
    expect(body.userId.length).toBeGreaterThan(0);

    const setCookie = response.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
    expect(cookieStr).toContain('bramha_session=');
    expect(cookieStr).toContain('HttpOnly');
  });

  it('POST /auth/login — wrong password returns 401 with generic message', async () => {
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name: 'Login Test', password: 'correct-horse-battery-staple' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrong-password-here' }),
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ code: string; title: string }>();
    expect(body.code).toBe('INVALID_CREDENTIALS');
    expect(body.title.toLowerCase()).toBe('invalid credentials');
  });

  it('POST /auth/login — non-existent email returns 401 with SAME generic message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'some-password' }),
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ code: string; title: string }>();
    expect(body.code).toBe('INVALID_CREDENTIALS');
    expect(body.title.toLowerCase()).toBe('invalid credentials');
  });

  it('POST /auth/logout — with valid session cookie returns 200 and clears cookie', async () => {
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name: 'Logout Test', password: 'correct-horse-battery-staple' }),
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
    });

    const cookieHeader = loginRes.headers['set-cookie'];
    const cookieStr = Array.isArray(cookieHeader) ? (cookieHeader[0] ?? '') : (cookieHeader ?? '');
    const tokenMatch = cookieStr.match(/bramha_session=([^;]+)/);
    expect(tokenMatch).not.toBeNull();
    const sessionCookie = `bramha_session=${tokenMatch![1]}`;

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: sessionCookie },
    });

    expect(logoutRes.statusCode).toBe(200);

    const clearCookie = logoutRes.headers['set-cookie'];
    const clearStr = Array.isArray(clearCookie) ? clearCookie.join('; ') : (clearCookie ?? '');
    expect(clearStr).toContain('Max-Age=0');
  });

  it('POST /auth/logout — without cookie returns 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
    });

    expect(response.statusCode).toBe(401);
  });
});
