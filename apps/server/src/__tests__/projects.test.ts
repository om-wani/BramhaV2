import 'reflect-metadata';
// Use an isolated in-memory PGlite instance per test file to avoid data-dir
// contention between parallel test workers.
process.env['PGLITE_DATA_DIR'] = `memory://projects-test-${Date.now()}`;
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

function uniqueEmail(): string {
  return `proj-test+${Date.now()}+${++counter}+${Math.random().toString(36).slice(2)}@example.com`;
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

async function createOrg(
  app: NestFastifyApplication,
  cookie: string,
  name = 'Test Org',
): Promise<{ orgId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name }),
  });
  expect(res.statusCode).toBe(201);
  const body = res.json<{ id: string }>();
  return { orgId: body.id };
}

describe('Projects endpoints', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // 1. POST /orgs/:orgId/projects — org member creates project → 201 with id/orgId/name/createdAt
  it('POST /orgs/:orgId/projects — org member creates project returns 201', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);

    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'My Project' }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; orgId: string; name: string; createdAt: string }>();
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
    expect(body.orgId).toBe(orgId);
    expect(body.name).toBe('My Project');
    expect(typeof body.createdAt).toBe('string');
  });

  // 2. POST /orgs/:orgId/projects — non-member gets 403
  it('POST /orgs/:orgId/projects — non-member gets 403', async () => {
    const { cookie: ownerCookie } = await registerAndLogin(app);
    const { cookie: nonMemberCookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, ownerCookie);

    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects`,
      headers: { 'content-type': 'application/json', cookie: nonMemberCookie },
      body: JSON.stringify({ name: 'Forbidden Project' }),
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  // 3. POST /orgs/:orgId/projects — bad body gets 400
  it('POST /orgs/:orgId/projects — bad body gets 400', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);

    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: '' }), // empty name fails min(1)
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  // 4. GET /orgs/:orgId/projects — lists projects in org, hides other orgs
  it('GET /orgs/:orgId/projects — lists projects, hides other orgs projects', async () => {
    const { cookie: cookieA } = await registerAndLogin(app);
    const { cookie: cookieB } = await registerAndLogin(app);
    const { orgId: orgIdA } = await createOrg(app, cookieA, 'Org A');
    const { orgId: orgIdB } = await createOrg(app, cookieB, 'Org B');

    // Create project in orgA
    await app.inject({
      method: 'POST',
      url: `/orgs/${orgIdA}/projects`,
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ name: 'Project In A' }),
    });

    // Create project in orgB
    await app.inject({
      method: 'POST',
      url: `/orgs/${orgIdB}/projects`,
      headers: { 'content-type': 'application/json', cookie: cookieB },
      body: JSON.stringify({ name: 'Project In B' }),
    });

    // List orgA's projects as userA
    const resA = await app.inject({
      method: 'GET',
      url: `/orgs/${orgIdA}/projects`,
      headers: { cookie: cookieA },
    });

    expect(resA.statusCode).toBe(200);
    const projectsA = resA.json<Array<{ id: string; name: string; createdAt: string }>>();
    const names = projectsA.map((p) => p.name);
    expect(names).toContain('Project In A');
    expect(names).not.toContain('Project In B');
  });

  // 5. GET /projects/:projectId — project member gets 200
  it('GET /projects/:projectId — project member gets 200', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);

    const createRes = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Visible Project' }),
    });
    const { id: projectId } = createRes.json<{ id: string }>();

    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; orgId: string; name: string; createdAt: string }>();
    expect(body.id).toBe(projectId);
    expect(body.orgId).toBe(orgId);
    expect(body.name).toBe('Visible Project');
  });

  // 6. GET /projects/:projectId — non-member gets 403
  it('GET /projects/:projectId — non-member gets 403', async () => {
    const { cookie: ownerCookie } = await registerAndLogin(app);
    const { cookie: nonMemberCookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, ownerCookie);

    const createRes = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ name: 'Hidden Project' }),
    });
    const { id: projectId } = createRes.json<{ id: string }>();

    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}`,
      headers: { cookie: nonMemberCookie },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  // 7. POST /projects/:projectId/members — admin adds member → 201
  it('POST /projects/:projectId/members — admin adds member returns 201', async () => {
    const { cookie: adminCookie } = await registerAndLogin(app);
    const { userId: newMemberId } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, adminCookie);

    const createRes = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'Members Project' }),
    });
    const { id: projectId } = createRes.json<{ id: string }>();

    const addRes = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/members`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ userId: newMemberId, role: 'member' }),
    });

    expect(addRes.statusCode).toBe(201);
    const body = addRes.json<{ projectId: string; userId: string; role: string }>();
    expect(body.projectId).toBe(projectId);
    expect(body.userId).toBe(newMemberId);
    expect(body.role).toBe('member');
  });

  // 8. POST /projects/:projectId/members — non-admin gets 403
  it('POST /projects/:projectId/members — non-admin gets 403', async () => {
    const { cookie: adminCookie } = await registerAndLogin(app);
    const { cookie: memberCookie, userId: memberId } = await registerAndLogin(app);
    const { userId: thirdUserId } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, adminCookie);

    const createRes = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'Perm Project' }),
    });
    const { id: projectId } = createRes.json<{ id: string }>();

    // Add member as non-admin
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/members`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ userId: memberId, role: 'member' }),
    });

    // Member tries to add another user
    const forbiddenRes = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/members`,
      headers: { 'content-type': 'application/json', cookie: memberCookie },
      body: JSON.stringify({ userId: thirdUserId, role: 'member' }),
    });

    expect(forbiddenRes.statusCode).toBe(403);
    const body = forbiddenRes.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  // 9. DELETE /projects/:projectId/members/:userId — admin removes member → 200
  it('DELETE /projects/:projectId/members/:userId — admin removes member returns 200', async () => {
    const { cookie: adminCookie } = await registerAndLogin(app);
    const { userId: memberId } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, adminCookie);

    const createRes = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'Remove Member Project' }),
    });
    const { id: projectId } = createRes.json<{ id: string }>();

    // Add member
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/members`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ userId: memberId, role: 'member' }),
    });

    // Remove member
    const removeRes = await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}/members/${memberId}`,
      headers: { cookie: adminCookie },
    });

    expect(removeRes.statusCode).toBe(200);
    expect(removeRes.json()).toEqual({});
  });

  // 10. DELETE /projects/:projectId/members/:userId — admin removes self → 403
  it('DELETE /projects/:projectId/members/:userId — admin removes self returns 403', async () => {
    const { cookie: adminCookie, userId: adminId } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, adminCookie);

    const createRes = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'Self Remove Project' }),
    });
    const { id: projectId } = createRes.json<{ id: string }>();

    const selfRemoveRes = await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}/members/${adminId}`,
      headers: { cookie: adminCookie },
    });

    expect(selfRemoveRes.statusCode).toBe(403);
    const body = selfRemoveRes.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  // 11. POST /orgs/:orgId/projects — nonexistent org → 404
  it('POST /orgs/:orgId/projects — nonexistent org returns 404', async () => {
    const { cookie } = await registerAndLogin(app);

    const res = await app.inject({
      method: 'POST',
      url: '/orgs/00000000-0000-0000-0000-000000000000/projects',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Ghost Project' }),
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('NOT_FOUND');
  });

  // 12. GET /orgs/:orgId/projects — non-member → 403
  it('GET /orgs/:orgId/projects — non-member returns 403', async () => {
    const { cookie: ownerCookie } = await registerAndLogin(app);
    const { cookie: nonMemberCookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, ownerCookie);

    const res = await app.inject({
      method: 'GET',
      url: `/orgs/${orgId}/projects`,
      headers: { cookie: nonMemberCookie },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  // 13. GET /projects/:projectId — not found → 404 (guard returns 403 since user is not a member)
  it('GET /projects/:projectId — nonexistent project returns 403 (guard fires before service)', async () => {
    const { cookie } = await registerAndLogin(app);

    const res = await app.inject({
      method: 'GET',
      url: '/projects/00000000-0000-0000-0000-000000000000',
      headers: { cookie },
    });

    // ProjectMemberGuard checks membership first; nonexistent project → no member row → 403
    expect(res.statusCode).toBe(403);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  // 14. POST /projects/:projectId/members — nonexistent project → guard fires first → 403
  it('POST /projects/:projectId/members — nonexistent project returns 403 (guard fires before service)', async () => {
    const { cookie } = await registerAndLogin(app);

    const res = await app.inject({
      method: 'POST',
      url: '/projects/00000000-0000-0000-0000-000000000000/members',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ userId: '00000000-0000-0000-0000-000000000001', role: 'member' }),
    });

    // Guard checks admin membership first; nonexistent project → no member row → 403
    expect(res.statusCode).toBe(403);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  // 15. POST /projects/:projectId/members — already member → 409
  it('POST /projects/:projectId/members — already member returns 409', async () => {
    const { cookie: adminCookie } = await registerAndLogin(app);
    const { userId: targetId } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, adminCookie);

    const createRes = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'Duplicate Member Project' }),
    });
    const { id: projectId } = createRes.json<{ id: string }>();

    // First add — succeeds
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/members`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ userId: targetId, role: 'member' }),
    });

    // Second add — conflict
    const dupRes = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/members`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ userId: targetId, role: 'member' }),
    });

    expect(dupRes.statusCode).toBe(409);
    const body = dupRes.json<{ code: string }>();
    expect(body.code).toBe('CONFLICT');
  });

  // 16. DELETE /projects/:projectId/members/:userId — non-admin member → 403
  it('DELETE /projects/:projectId/members/:userId — non-admin member returns 403', async () => {
    const { cookie: adminCookie } = await registerAndLogin(app);
    const { cookie: memberCookie, userId: memberId } = await registerAndLogin(app);
    const { userId: otherMemberId } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, adminCookie);

    const createRes = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'Non-Admin Remove Project' }),
    });
    const { id: projectId } = createRes.json<{ id: string }>();

    // Add both members
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/members`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ userId: memberId, role: 'member' }),
    });
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/members`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ userId: otherMemberId, role: 'member' }),
    });

    // Non-admin member tries to remove another member
    const res = await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}/members/${otherMemberId}`,
      headers: { cookie: memberCookie },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });

  // 17. DELETE /projects/:projectId/members/:userId — member not found → 404
  it('DELETE /projects/:projectId/members/:userId — member not found returns 404', async () => {
    const { cookie: adminCookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, adminCookie);

    const createRes = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'Not Found Member Project' }),
    });
    const { id: projectId } = createRes.json<{ id: string }>();

    const res = await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}/members/00000000-0000-0000-0000-000000000000`,
      headers: { cookie: adminCookie },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('NOT_FOUND');
  });

  // 18. Unauthenticated requests → 401
  it('unauthenticated GET /orgs/:orgId/projects returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/orgs/00000000-0000-0000-0000-000000000000/projects',
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('unauthenticated GET /projects/:projectId returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/projects/00000000-0000-0000-0000-000000000000',
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('UNAUTHORIZED');
  });
});
