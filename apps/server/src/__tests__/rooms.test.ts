import 'reflect-metadata';
// Use an isolated in-memory PGlite instance per test file.
process.env['PGLITE_DATA_DIR'] = `memory://rooms-test-${Date.now()}`;
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import fastifyCookie from '@fastify/cookie';
import { migrate } from '@bramha/db';
import { AuthModule } from '../modules/auth/auth.module.js';
import { OrgsModule } from '../modules/orgs/orgs.module.js';
import { ProjectsModule } from '../modules/projects/projects.module.js';
import { RoomsModule } from '../modules/rooms/rooms.module.js';
import { ConversationModule } from '../modules/conversation/conversation.module.js';
import { ConversationService } from '../modules/conversation/conversation.service.js';
import { ProblemJsonExceptionFilter } from '../common/filters/problem-json.filter.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

interface AppAndService {
  app: NestFastifyApplication;
  conversationService: ConversationService;
}

async function buildApp(): Promise<AppAndService> {
  await migrate();

  const module = await Test.createTestingModule({
    imports: [AuthModule, OrgsModule, ProjectsModule, RoomsModule, ConversationModule],
  }).compile();

  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ProblemJsonExceptionFilter());
  await app.register(fastifyCookie);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const conversationService = module.get(ConversationService);
  return { app, conversationService };
}

let counter = 0;

function uniqueEmail(): string {
  return `rooms-test+${Date.now()}+${++counter}+${Math.random().toString(36).slice(2)}@example.com`;
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
  return { orgId: res.json<{ id: string }>().id };
}

async function createProject(
  app: NestFastifyApplication,
  cookie: string,
  orgId: string,
  name = 'Test Project',
): Promise<{ projectId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/projects`,
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name }),
  });
  expect(res.statusCode).toBe(201);
  return { projectId: res.json<{ id: string }>().id };
}

async function createRoom(
  app: NestFastifyApplication,
  cookie: string,
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ id: string; mainBranchId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/rooms`,
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string; mainBranchId: string }>();
}

// ---------------------------------------------------------------------------
// P2.1 — Rooms tests
// ---------------------------------------------------------------------------

describe('Rooms (P2.1)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ app } = await buildApp());
  });

  afterAll(async () => {
    await app.close();
  });

  // 1. POST — council room
  it('POST /projects/:id/rooms — council room returns 201 with mainBranchId', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);
    const { projectId } = await createProject(app, cookie, orgId);

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Council Room', kind: 'council' }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{
      id: string;
      projectId: string;
      name: string;
      kind: string;
      persona: null;
      mainBranchId: string;
      createdAt: string;
    }>();
    expect(typeof body.id).toBe('string');
    expect(body.projectId).toBe(projectId);
    expect(body.name).toBe('Council Room');
    expect(body.kind).toBe('council');
    expect(body.persona).toBeNull();
    expect(typeof body.mainBranchId).toBe('string');
    expect(body.mainBranchId.length).toBeGreaterThan(0);
    expect(typeof body.createdAt).toBe('string');
  });

  // 2. POST — one_on_one room with persona
  it('POST /projects/:id/rooms — one_on_one room with valid persona returns 201', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);
    const { projectId } = await createProject(app, cookie, orgId);

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: '1:1 with CTO', kind: 'one_on_one', persona: 'cto' }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ kind: string; persona: string; mainBranchId: string }>();
    expect(body.kind).toBe('one_on_one');
    expect(body.persona).toBe('cto');
    expect(typeof body.mainBranchId).toBe('string');
  });

  // 3. POST — one_on_one without persona → 400
  it('POST /projects/:id/rooms — one_on_one without persona returns 400', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);
    const { projectId } = await createProject(app, cookie, orgId);

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Bad Room', kind: 'one_on_one' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe('VALIDATION_ERROR');
  });

  // 4. POST — council with persona → 400
  it('POST /projects/:id/rooms — council with persona returns 400', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);
    const { projectId } = await createProject(app, cookie, orgId);

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Bad Council', kind: 'council', persona: 'ceo' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe('VALIDATION_ERROR');
  });

  // 5. POST — non-member → 403
  it('POST /projects/:id/rooms — non-member returns 403', async () => {
    const { cookie: ownerCookie } = await registerAndLogin(app);
    const { cookie: otherCookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, ownerCookie);
    const { projectId } = await createProject(app, ownerCookie, orgId);

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms`,
      headers: { 'content-type': 'application/json', cookie: otherCookie },
      body: JSON.stringify({ name: 'Forbidden Room', kind: 'council' }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<{ code: string }>().code).toBe('FORBIDDEN');
  });

  // 6. GET — list rooms
  it('GET /projects/:id/rooms — lists rooms for project member', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);
    const { projectId } = await createProject(app, cookie, orgId);

    // Create two rooms
    await createRoom(app, cookie, projectId, { name: 'Room A', kind: 'council' });
    await createRoom(app, cookie, projectId, { name: 'Room B', kind: 'one_on_one', persona: 'ceo' });

    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/rooms`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const rooms = res.json<Array<{ name: string; kind: string }>>();
    const names = rooms.map((r) => r.name);
    expect(names).toContain('Room A');
    expect(names).toContain('Room B');
  });
});

// ---------------------------------------------------------------------------
// P2.2 — Conversation tests
// ---------------------------------------------------------------------------

describe('Conversation (P2.2)', () => {
  let app: NestFastifyApplication;
  let conversationService: ConversationService;

  beforeAll(async () => {
    ({ app, conversationService } = await buildApp());
  });

  afterAll(async () => {
    await app.close();
  });

  // 7. POST .../nodes — insert first message
  it('POST .../nodes — insert first message returns 201 with forked: false', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);
    const { projectId } = await createProject(app, cookie, orgId);
    const { id: roomId, mainBranchId } = await createRoom(app, cookie, projectId, {
      name: 'Chat Room',
      kind: 'council',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms/${roomId}/nodes`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ branchId: mainBranchId, content: 'Hello council!' }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{
      nodeId: string;
      branchId: string;
      forked: boolean;
      newBranchId?: string;
    }>();
    expect(typeof body.nodeId).toBe('string');
    expect(body.branchId).toBe(mainBranchId);
    expect(body.forked).toBe(false);
    expect(body.newBranchId).toBeUndefined();
  });

  // 8. POST .../nodes — insert second message advances head
  it('POST .../nodes — insert second message advances head, forked: false', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);
    const { projectId } = await createProject(app, cookie, orgId);
    const { id: roomId, mainBranchId } = await createRoom(app, cookie, projectId, {
      name: 'Chat Room 2',
      kind: 'council',
    });

    // First message
    const first = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms/${roomId}/nodes`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ branchId: mainBranchId, content: 'First' }),
    });
    expect(first.statusCode).toBe(201);
    const { nodeId: firstNodeId } = first.json<{ nodeId: string }>();

    // Second message with parent
    const second = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms/${roomId}/nodes`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        branchId: mainBranchId,
        content: 'Second',
        parentNodeId: firstNodeId,
      }),
    });
    expect(second.statusCode).toBe(201);
    const body = second.json<{ nodeId: string; branchId: string; forked: boolean }>();
    expect(body.forked).toBe(false);
    expect(body.branchId).toBe(mainBranchId);
  });

  // 9. POST .../branches — create branch from node
  it('POST .../branches — create branch from node returns 201 with headNodeId', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);
    const { projectId } = await createProject(app, cookie, orgId);
    const { id: roomId, mainBranchId } = await createRoom(app, cookie, projectId, {
      name: 'Branch Test Room',
      kind: 'council',
    });

    // Insert a node first
    const nodeRes = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms/${roomId}/nodes`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ branchId: mainBranchId, content: 'Root message' }),
    });
    const { nodeId } = nodeRes.json<{ nodeId: string }>();

    // Create branch from that node
    const branchRes = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms/${roomId}/branches`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ fromNodeId: nodeId, name: 'alt-branch' }),
    });

    expect(branchRes.statusCode).toBe(201);
    const body = branchRes.json<{
      id: string;
      name: string;
      headNodeId: string;
      forkedFromNodeId: string;
    }>();
    expect(typeof body.id).toBe('string');
    expect(body.name).toBe('alt-branch');
    expect(body.headNodeId).toBe(nodeId);
    expect(body.forkedFromNodeId).toBe(nodeId);
  });

  // 10. GET .../thread — returns nodes root-first
  it('GET .../thread — returns nodes root-first', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);
    const { projectId } = await createProject(app, cookie, orgId);
    const { id: roomId, mainBranchId } = await createRoom(app, cookie, projectId, {
      name: 'Thread Test Room',
      kind: 'council',
    });

    // Insert message 1
    const n1 = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms/${roomId}/nodes`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ branchId: mainBranchId, content: 'Msg 1' }),
    });
    const { nodeId: node1Id } = n1.json<{ nodeId: string }>();

    // Insert message 2 (child of 1)
    const n2 = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms/${roomId}/nodes`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        branchId: mainBranchId,
        content: 'Msg 2',
        parentNodeId: node1Id,
      }),
    });
    const { nodeId: node2Id } = n2.json<{ nodeId: string }>();

    // Insert message 3 (child of 2)
    const n3 = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms/${roomId}/nodes`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        branchId: mainBranchId,
        content: 'Msg 3',
        parentNodeId: node2Id,
      }),
    });
    expect(n3.statusCode).toBe(201);

    const threadRes = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/rooms/${roomId}/branches/${mainBranchId}/thread`,
      headers: { cookie },
    });

    expect(threadRes.statusCode).toBe(200);
    const nodes = threadRes.json<Array<{ id: string; content: string }>>();
    expect(nodes.length).toBe(3);
    expect(nodes[0]?.content).toBe('Msg 1');
    expect(nodes[1]?.content).toBe('Msg 2');
    expect(nodes[2]?.content).toBe('Msg 3');
  });

  // 11a. POST .../nodes — concurrent conflict auto-forks to new branch
  it('POST .../nodes — concurrent conflict auto-forks to new branch', async () => {
    const { cookie, userId } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);
    const { projectId } = await createProject(app, cookie, orgId);
    const { id: roomId, mainBranchId: branchId } = await createRoom(app, cookie, projectId, {
      name: 'Fork Test Room',
      kind: 'council',
    });

    // Insert first node normally via HTTP → head = node1
    const firstRes = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms/${roomId}/nodes`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ branchId, content: 'first' }),
    });
    expect(firstRes.statusCode).toBe(201);
    const { nodeId: firstNodeId } = firstRes.json<{ nodeId: string }>();

    // Call insertNode twice concurrently via the service (same JS event loop, interleaved awaits).
    // Both reads see head = node1; only the first UPDATE succeeds; the second triggers auto-fork.
    const [aResult, bResult] = await Promise.all([
      conversationService.insertNode(userId, projectId, roomId, branchId, 'concurrent A', firstNodeId),
      conversationService.insertNode(userId, projectId, roomId, branchId, 'concurrent B', firstNodeId),
    ]);

    // At least one must have forked
    const forkCount = [aResult.forked, bResult.forked].filter(Boolean).length;
    expect(forkCount).toBeGreaterThanOrEqual(1);
    const forkedResult = aResult.forked ? aResult : bResult;
    expect(forkedResult.newBranchId).toBeDefined();
  });

  // 11. GET .../branches — lists branches
  it('GET .../branches — lists branches for room', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);
    const { projectId } = await createProject(app, cookie, orgId);
    const { id: roomId, mainBranchId } = await createRoom(app, cookie, projectId, {
      name: 'List Branches Room',
      kind: 'council',
    });

    // Insert a node and create a named branch
    const nodeRes = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms/${roomId}/nodes`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ branchId: mainBranchId, content: 'First' }),
    });
    const { nodeId } = nodeRes.json<{ nodeId: string }>();

    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms/${roomId}/branches`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ fromNodeId: nodeId, name: 'feature-branch' }),
    });

    const listRes = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/rooms/${roomId}/branches`,
      headers: { cookie },
    });

    expect(listRes.statusCode).toBe(200);
    const branchesList = listRes.json<Array<{ id: string; name: string }>>();
    const names = branchesList.map((b) => b.name);
    expect(names).toContain('main');
    expect(names).toContain('feature-branch');
  });

  // 13. GET /projects/:projectId/rooms — 403 for non-member
  it('GET /projects/:projectId/rooms — non-member gets 403', async () => {
    const { cookie: ownerCookie } = await registerAndLogin(app);
    const { cookie: otherCookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, ownerCookie);
    const { projectId } = await createProject(app, ownerCookie, orgId);

    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/rooms`,
      headers: { cookie: otherCookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ code: string }>().code).toBe('FORBIDDEN');
  });

  // 14. Unauthenticated requests → 401
  it('POST /projects/:id/rooms — unauthenticated returns 401', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);
    const { projectId } = await createProject(app, cookie, orgId);

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Unauth Room', kind: 'council' }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ code: string }>().code).toBe('UNAUTHORIZED');
  });

  it('GET .../branches — unauthenticated returns 401', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);
    const { projectId } = await createProject(app, cookie, orgId);
    const { id: roomId } = await createRoom(app, cookie, projectId, { name: 'Room', kind: 'council' });

    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/rooms/${roomId}/branches`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ code: string }>().code).toBe('UNAUTHORIZED');
  });

  // 15. GET .../thread — empty branch returns []
  it('GET .../thread — empty branch (head_node_id = NULL) returns []', async () => {
    const { cookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, cookie);
    const { projectId } = await createProject(app, cookie, orgId);
    const { id: roomId, mainBranchId } = await createRoom(app, cookie, projectId, {
      name: 'Empty Thread Room',
      kind: 'council',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/rooms/${roomId}/branches/${mainBranchId}/thread`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<unknown[]>()).toEqual([]);
  });

  // 16. GET .../branches — 403 for non-member
  it('GET .../branches — non-member gets 403', async () => {
    const { cookie: ownerCookie } = await registerAndLogin(app);
    const { cookie: otherCookie } = await registerAndLogin(app);
    const { orgId } = await createOrg(app, ownerCookie);
    const { projectId } = await createProject(app, ownerCookie, orgId);
    const { id: roomId } = await createRoom(app, ownerCookie, projectId, { name: 'Room', kind: 'council' });

    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/rooms/${roomId}/branches`,
      headers: { cookie: otherCookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ code: string }>().code).toBe('FORBIDDEN');
  });
});
