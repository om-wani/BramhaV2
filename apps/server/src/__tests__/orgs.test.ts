import 'reflect-metadata';
// Use an isolated in-memory PGlite instance per test file to avoid data-dir
// contention between parallel test workers.
process.env['PGLITE_DATA_DIR'] = `memory://orgs-test-${Date.now()}`;
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import fastifyCookie from '@fastify/cookie';
import { migrate } from '@bramha/db';
import { AuthModule } from '../modules/auth/auth.module.js';
import { OrgsModule } from '../modules/orgs/orgs.module.js';
import { ProblemJsonExceptionFilter } from '../common/filters/problem-json.filter.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

async function buildApp(): Promise<NestFastifyApplication> {
  await migrate();

  const module = await Test.createTestingModule({
    imports: [AuthModule, OrgsModule],
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

function uniqueEmail(): string {
  return `org-test+${Date.now()}+${++counter}+${Math.random().toString(36).slice(2)}@example.com`;
}

async function registerAndLogin(
  app: NestFastifyApplication,
  name = 'Test User',
): Promise<{ cookie: string; userId: string }> {
  const email = uniqueEmail();
  const password = 'correct-horse-battery-staple';

  await app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, name, password }),
  });

  const loginRes = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  expect(loginRes.statusCode).toBe(200);
  const body = loginRes.json<{ userId: string }>();
  const userId = body.userId;

  const cookieHeader = loginRes.headers['set-cookie'];
  const cookieStr = Array.isArray(cookieHeader) ? (cookieHeader[0] ?? '') : (cookieHeader ?? '');
  const tokenMatch = cookieStr.match(/bramha_session=([^;]+)/);
  expect(tokenMatch).not.toBeNull();
  const cookie = `bramha_session=${tokenMatch![1]}`;

  return { cookie, userId };
}

describe('Orgs endpoints', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // 1. POST /orgs — creates org, returns 201 with id/name/createdAt
  it('POST /orgs — creates org, returns 201 with id/name/createdAt', async () => {
    const { cookie } = await registerAndLogin(app);

    const res = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Acme Corp' }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; name: string; createdAt: string }>();
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
    expect(body.name).toBe('Acme Corp');
    expect(typeof body.createdAt).toBe('string');
  });

  // 2. POST /orgs — no auth returns 401
  it('POST /orgs — no auth returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Org' }),
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  // 3. POST /orgs — bad body returns 400
  it('POST /orgs — bad body returns 400', async () => {
    const { cookie } = await registerAndLogin(app);

    const res = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: '' }), // empty name fails min(1)
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  // 4. GET /orgs — lists only orgs caller belongs to
  it('GET /orgs — lists only orgs caller belongs to', async () => {
    const { cookie: cookieA } = await registerAndLogin(app);
    const { cookie: cookieB } = await registerAndLogin(app);

    // User A creates an org
    await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ name: 'A Org' }),
    });

    // User B creates a different org
    await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: { 'content-type': 'application/json', cookie: cookieB },
      body: JSON.stringify({ name: 'B Org' }),
    });

    const resA = await app.inject({
      method: 'GET',
      url: '/orgs',
      headers: { cookie: cookieA },
    });

    expect(resA.statusCode).toBe(200);
    const orgsA = resA.json<Array<{ name: string; role: string }>>();
    // User A should see their own org(s) but not B's org
    const names = orgsA.map((o) => o.name);
    expect(names).toContain('A Org');
    expect(names).not.toContain('B Org');
    // Each entry has role field
    for (const o of orgsA) {
      expect(typeof o.role).toBe('string');
    }
  });

  // 5. POST /orgs/:orgId/members — owner can add member
  it('POST /orgs/:orgId/members — owner can add member', async () => {
    const { cookie: ownerCookie } = await registerAndLogin(app);
    const { userId: newMemberId } = await registerAndLogin(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ name: 'Owner Org' }),
    });
    const { id: orgId } = createRes.json<{ id: string }>();

    const addRes = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/members`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ userId: newMemberId, role: 'member' }),
    });

    expect(addRes.statusCode).toBe(201);
    const body = addRes.json<{ orgId: string; userId: string; role: string }>();
    expect(body.orgId).toBe(orgId);
    expect(body.userId).toBe(newMemberId);
    expect(body.role).toBe('member');
  });

  // 6. POST /orgs/:orgId/members — non-owner gets 403
  it('POST /orgs/:orgId/members — non-owner gets 403', async () => {
    const { cookie: ownerCookie } = await registerAndLogin(app);
    const { cookie: memberCookie, userId: memberId } = await registerAndLogin(app);
    const { userId: thirdUserId } = await registerAndLogin(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ name: 'Perm Test Org' }),
    });
    const { id: orgId } = createRes.json<{ id: string }>();

    // Add memberId as a member (not owner)
    await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/members`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ userId: memberId, role: 'member' }),
    });

    // Member tries to add another user — should get 403
    const forbiddenRes = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/members`,
      headers: { 'content-type': 'application/json', cookie: memberCookie },
      body: JSON.stringify({ userId: thirdUserId, role: 'member' }),
    });

    expect(forbiddenRes.statusCode).toBe(403);
    const body = forbiddenRes.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  // 7. DELETE /orgs/:orgId/members/:userId — owner removes other member
  it('DELETE /orgs/:orgId/members/:userId — owner removes other member', async () => {
    const { cookie: ownerCookie } = await registerAndLogin(app);
    const { userId: memberId } = await registerAndLogin(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ name: 'Remove Test Org' }),
    });
    const { id: orgId } = createRes.json<{ id: string }>();

    // Add member
    await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/members`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ userId: memberId, role: 'member' }),
    });

    // Remove member
    const removeRes = await app.inject({
      method: 'DELETE',
      url: `/orgs/${orgId}/members/${memberId}`,
      headers: { cookie: ownerCookie },
    });

    expect(removeRes.statusCode).toBe(204);
    expect(removeRes.body).toBe('');
  });

  // 8. DELETE /orgs/:orgId/members/:userId — owner cannot remove self (403)
  it('DELETE /orgs/:orgId/members/:userId — owner cannot remove self (403)', async () => {
    const { cookie: ownerCookie, userId: ownerId } = await registerAndLogin(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ name: 'Self Remove Org' }),
    });
    const { id: orgId } = createRes.json<{ id: string }>();

    const selfRemoveRes = await app.inject({
      method: 'DELETE',
      url: `/orgs/${orgId}/members/${ownerId}`,
      headers: { cookie: ownerCookie },
    });

    expect(selfRemoveRes.statusCode).toBe(403);
    const body = selfRemoveRes.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  // 9. GET /orgs/:orgId/members — member can list, non-member gets 403
  it('GET /orgs/:orgId/members — member can list, non-member gets 403', async () => {
    const { cookie: ownerCookie, userId: ownerId } = await registerAndLogin(app);
    const { cookie: nonMemberCookie } = await registerAndLogin(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ name: 'List Members Org' }),
    });
    const { id: orgId } = createRes.json<{ id: string }>();

    // Owner can list members
    const listRes = await app.inject({
      method: 'GET',
      url: `/orgs/${orgId}/members`,
      headers: { cookie: ownerCookie },
    });

    expect(listRes.statusCode).toBe(200);
    const members = listRes.json<Array<{ userId: string; name: string | null; email: string; role: string }>>();
    expect(members.length).toBeGreaterThanOrEqual(1);
    const ownerEntry = members.find((m) => m.userId === ownerId);
    expect(ownerEntry).toBeDefined();
    expect(ownerEntry!.role).toBe('owner');
    // name is null until onboarding sets it (signup no longer collects a name).
    expect(ownerEntry!.name === null || typeof ownerEntry!.name === 'string').toBe(true);
    expect(typeof ownerEntry!.email).toBe('string');

    // Non-member gets 403
    const forbiddenRes = await app.inject({
      method: 'GET',
      url: `/orgs/${orgId}/members`,
      headers: { cookie: nonMemberCookie },
    });

    expect(forbiddenRes.statusCode).toBe(403);
    const body = forbiddenRes.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  // Bonus: POST /orgs/:orgId/members — 409 if already member
  it('POST /orgs/:orgId/members — 409 if already member', async () => {
    const { cookie: ownerCookie } = await registerAndLogin(app);
    const { userId: memberId } = await registerAndLogin(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ name: 'Conflict Test Org' }),
    });
    const { id: orgId } = createRes.json<{ id: string }>();

    // Add member first time
    await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/members`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ userId: memberId, role: 'member' }),
    });

    // Add same member second time
    const conflictRes = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/members`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ userId: memberId, role: 'member' }),
    });

    expect(conflictRes.statusCode).toBe(409);
    const body = conflictRes.json<{ code: string }>();
    expect(body.code).toBe('CONFLICT');
  });

  // Bonus: POST /orgs/:orgId/members — 404 if org not found
  it('POST /orgs/:orgId/members — 404 if org not found', async () => {
    const { cookie } = await registerAndLogin(app);

    const res = await app.inject({
      method: 'POST',
      url: '/orgs/00000000-0000-0000-0000-000000000000/members',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ userId: '00000000-0000-0000-0000-000000000001', role: 'member' }),
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ code: string; title: string }>();
    expect(body.code).toBe('NOT_FOUND');
    expect(body.title).toBeDefined();
  });

  // DELETE with nonexistent org → 404
  it('DELETE /orgs/:orgId/members/:userId — nonexistent org returns 404', async () => {
    const { cookie, userId } = await registerAndLogin(app);

    const res = await app.inject({
      method: 'DELETE',
      url: `/orgs/00000000-0000-0000-0000-000000000000/members/${userId}`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('NOT_FOUND');
  });

  // DELETE non-owner (not self) → 403
  it('DELETE /orgs/:orgId/members/:userId — non-owner gets 403', async () => {
    const { cookie: ownerCookie } = await registerAndLogin(app);
    const { userId: memberId } = await registerAndLogin(app);
    const { cookie: nonOwnerCookie } = await registerAndLogin(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ name: 'Non-owner Remove Org' }),
    });
    const { id: orgId } = createRes.json<{ id: string }>();

    // Add memberId as member
    await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/members`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ userId: memberId, role: 'member' }),
    });

    // Non-owner tries to remove the member
    const res = await app.inject({
      method: 'DELETE',
      url: `/orgs/${orgId}/members/${memberId}`,
      headers: { cookie: nonOwnerCookie },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ code: string; title: string }>();
    expect(body.code).toBe('FORBIDDEN');
    expect(body.title).toBeDefined();
  });

  // GET /orgs without auth → 401
  it('GET /orgs — no auth returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/orgs',
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ code: string; title: string }>();
    expect(body.code).toBe('UNAUTHORIZED');
    expect(body.title).toBeDefined();
  });

  // POST /orgs/:orgId/members without auth → 401
  it('POST /orgs/:orgId/members — no auth returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orgs/00000000-0000-0000-0000-000000000000/members',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: '00000000-0000-0000-0000-000000000001', role: 'member' }),
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  // DELETE /orgs/:orgId/members/:userId without auth → 401
  it('DELETE /orgs/:orgId/members/:userId — no auth returns 401', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/orgs/00000000-0000-0000-0000-000000000000/members/00000000-0000-0000-0000-000000000001',
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  // GET /orgs/:orgId/members without auth → 401
  it('GET /orgs/:orgId/members — no auth returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/orgs/00000000-0000-0000-0000-000000000000/members',
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('UNAUTHORIZED');
  });
});
