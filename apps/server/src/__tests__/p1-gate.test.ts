import 'reflect-metadata';
// Use an isolated in-memory PGlite instance per test file to avoid data-dir
// contention between parallel test workers.
process.env['PGLITE_DATA_DIR'] = `memory://p1-gate-test-${Date.now()}`;
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import fastifyCookie from '@fastify/cookie';
import { migrate } from '@bramha/db';
import { AuthModule } from '../modules/auth/auth.module.js';
import { OrgsModule } from '../modules/orgs/orgs.module.js';
import { ProjectsModule } from '../modules/projects/projects.module.js';
import { ProblemJsonExceptionFilter } from '../common/filters/problem-json.filter.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

async function buildApp(): Promise<NestFastifyApplication> {
  await migrate();

  const module = await Test.createTestingModule({
    imports: [AuthModule, OrgsModule, ProjectsModule],
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

let counter = 0;

async function createUser(
  app: NestFastifyApplication,
  suffix: string,
): Promise<{ cookie: string; userId: string }> {
  const email = `gate-test-${suffix}-${Date.now()}-${++counter}@example.com`;
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, name: `User ${suffix}`, password: 'correct-horse-battery-staple' }),
  });
  const loginRes = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
  });
  const cookieHeader = loginRes.headers['set-cookie'];
  const cookieStr = Array.isArray(cookieHeader) ? (cookieHeader[0] ?? '') : (cookieHeader ?? '');
  const match = cookieStr.match(/bramha_session=([^;]+)/);
  expect(match).not.toBeNull();
  return { cookie: `bramha_session=${match![1]}`, userId: loginRes.json<{ userId: string }>().userId };
}

async function createOrg(
  app: NestFastifyApplication,
  cookie: string,
  name: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name }),
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
}

async function createProject(
  app: NestFastifyApplication,
  cookie: string,
  orgId: string,
  name: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/projects`,
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name }),
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
}

describe('P1 gate — cross-org isolation + auth gate', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Cross-org isolation ─────────────────────────────────────────────────────

  it('1. User A cannot see User B org in GET /orgs', async () => {
    const userA = await createUser(app, 'a1');
    const userB = await createUser(app, 'b1');

    const orgAId = await createOrg(app, userA.cookie, 'Org A');
    await createOrg(app, userB.cookie, 'Org B');

    const res = await app.inject({
      method: 'GET',
      url: '/orgs',
      headers: { cookie: userA.cookie },
    });

    expect(res.statusCode).toBe(200);
    const orgs = res.json<Array<{ id: string; name: string }>>();
    const ids = orgs.map((o) => o.id);
    expect(ids).toContain(orgAId);
    const names = orgs.map((o) => o.name);
    expect(names).not.toContain('Org B');
  });

  it('2. User A cannot access User B org members — 403', async () => {
    const userA = await createUser(app, 'a2');
    const userB = await createUser(app, 'b2');

    const orgBId = await createOrg(app, userB.cookie, 'Org B Members');

    const res = await app.inject({
      method: 'GET',
      url: `/orgs/${orgBId}/members`,
      headers: { cookie: userA.cookie },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  it('3. User A cannot create project in User B org — 403', async () => {
    const userA = await createUser(app, 'a3');
    const userB = await createUser(app, 'b3');

    const orgBId = await createOrg(app, userB.cookie, 'Org B Projects');

    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgBId}/projects`,
      headers: { 'content-type': 'application/json', cookie: userA.cookie },
      body: JSON.stringify({ name: 'Infiltrator Project' }),
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  it('4. User A cannot list projects in User B org — 403', async () => {
    const userA = await createUser(app, 'a4');
    const userB = await createUser(app, 'b4');

    const orgBId = await createOrg(app, userB.cookie, 'Org B Project List');
    // B creates a project so the list isn't trivially empty
    await createProject(app, userB.cookie, orgBId, 'B Secret Project');

    const res = await app.inject({
      method: 'GET',
      url: `/orgs/${orgBId}/projects`,
      headers: { cookie: userA.cookie },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  it('5. User A cannot GET project created by User B — 403', async () => {
    const userA = await createUser(app, 'a5');
    const userB = await createUser(app, 'b5');

    const orgBId = await createOrg(app, userB.cookie, 'Org B Direct');
    const projectBId = await createProject(app, userB.cookie, orgBId, 'B Direct Project');

    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectBId}`,
      headers: { cookie: userA.cookie },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  // ── Auth gate (server-level: no cookie → 401) ───────────────────────────────

  it('6. No cookie → 401 on GET /orgs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/orgs',
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('7. No cookie → 401 on POST /orgs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ghost Org' }),
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('8. Expired/invalid session token → 401 on GET /orgs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/orgs',
      headers: { cookie: 'bramha_session=invalid-token-that-does-not-exist-in-db' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('UNAUTHORIZED');
  });
});
