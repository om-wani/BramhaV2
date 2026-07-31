import 'reflect-metadata';
// Use an isolated in-memory PGlite instance per test file to avoid data-dir
// contention between parallel test workers.
process.env['PGLITE_DATA_DIR'] = `memory://p2-gate-test-${Date.now()}`;
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
import { ProblemJsonExceptionFilter } from '../common/filters/problem-json.filter.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

async function buildApp(): Promise<NestFastifyApplication> {
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
  return app;
}

let counter = 0;

function uniqueEmail(): string {
  return `p2-gate+${Date.now()}+${++counter}+${Math.random().toString(36).slice(2)}@example.com`;
}

async function registerAndLogin(app: NestFastifyApplication): Promise<{ cookie: string; userId: string }> {
  const email = uniqueEmail();
  const password = 'CorrectHorseBatteryStaple99!';

  await app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, name: 'Gate User', password }),
  });

  const loginRes = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  expect(loginRes.statusCode).toBe(200);
  const cookieHeader = loginRes.headers['set-cookie'];
  const cookieStr = Array.isArray(cookieHeader) ? (cookieHeader[0] ?? '') : (cookieHeader ?? '');
  const match = cookieStr.match(/bramha_session=([^;]+)/);
  expect(match).not.toBeNull();
  const cookie = `bramha_session=${match![1]}`;
  const userId = loginRes.json<{ userId: string }>().userId;
  return { cookie, userId };
}

async function postNode(
  app: NestFastifyApplication,
  cookie: string,
  projectId: string,
  roomId: string,
  branchId: string,
  content: string,
  parentNodeId?: string,
): Promise<{ nodeId: string; branchId: string; forked: boolean; newBranchId?: string }> {
  const body: Record<string, unknown> = { branchId, content };
  if (parentNodeId !== undefined) body['parentNodeId'] = parentNodeId;

  const res = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/rooms/${roomId}/nodes`,
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ nodeId: string; branchId: string; forked: boolean; newBranchId?: string }>();
}

async function getThread(
  app: NestFastifyApplication,
  cookie: string,
  projectId: string,
  roomId: string,
  branchId: string,
): Promise<Array<{ id: string; content: string }>> {
  const res = await app.inject({
    method: 'GET',
    url: `/projects/${projectId}/rooms/${roomId}/branches/${branchId}/thread`,
    headers: { cookie },
  });
  expect(res.statusCode).toBe(200);
  return res.json<Array<{ id: string; content: string }>>();
}

// ---------------------------------------------------------------------------
// P2 gate — branch mid-thread, both lineages survive hard refresh
// ---------------------------------------------------------------------------

describe('P2 gate — branch mid-thread, both lineages survive hard refresh', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('full P2 DAG contract: two branches diverge at node #2, both survive hard refresh', async () => {
    // ── Setup ────────────────────────────────────────────────────────────────
    const { cookie } = await registerAndLogin(app);

    // Create org
    const orgRes = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Gate Org' }),
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = orgRes.json<{ id: string }>().id;

    // Create project
    const projRes = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Gate Project' }),
    });
    expect(projRes.statusCode).toBe(201);
    const projectId = projRes.json<{ id: string }>().id;

    // Create room (council)
    const roomRes = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Gate Room', personas: ['ceo'] }),
    });
    expect(roomRes.statusCode).toBe(201);
    const { id: roomId, mainBranchId } = roomRes.json<{ id: string; mainBranchId: string }>();

    // ── Step 1: Send 3 messages to main branch ───────────────────────────────
    // Message 1 — no parent (first node)
    const { nodeId: node1Id } = await postNode(app, cookie, projectId, roomId, mainBranchId, 'Message 1');

    // Message 2 — child of node1
    const { nodeId: node2Id } = await postNode(app, cookie, projectId, roomId, mainBranchId, 'Message 2', node1Id);

    // Message 3 — child of node2
    const { nodeId: node3Id } = await postNode(app, cookie, projectId, roomId, mainBranchId, 'Message 3', node2Id);

    // ── Step 2: Create named fork branch from node2 ──────────────────────────
    const branchRes = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/rooms/${roomId}/branches`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ fromNodeId: node2Id, name: 'fork-branch' }),
    });
    expect(branchRes.statusCode).toBe(201);
    const forkBranch = branchRes.json<{ id: string; name: string; headNodeId: string; forkedFromNodeId: string }>();
    expect(forkBranch.name).toBe('fork-branch');
    expect(forkBranch.headNodeId).toBe(node2Id);
    expect(forkBranch.forkedFromNodeId).toBe(node2Id);
    const forkBranchId = forkBranch.id;

    // ── Step 3: Send message 4 to main branch (continuing from node3) ────────
    const { nodeId: node4Id, forked: mainForked } = await postNode(
      app, cookie, projectId, roomId, mainBranchId, 'Message 4 (main only)', node3Id,
    );
    expect(mainForked).toBe(false);

    // ── Step 4: Send fork-message to fork branch (continuing from node2) ─────
    const { nodeId: forkMsgId, forked: forkForked } = await postNode(
      app, cookie, projectId, roomId, forkBranchId, 'Fork message', node2Id,
    );
    expect(forkForked).toBe(false);

    // ── Step 5: Hard refresh = fetch thread for both branches via GET ─────────
    const mainThread = await getThread(app, cookie, projectId, roomId, mainBranchId);
    const forkThread = await getThread(app, cookie, projectId, roomId, forkBranchId);

    // ── Assert: main branch thread has nodes 1, 2, 3, 4 ─────────────────────
    expect(mainThread.length).toBe(4);
    const mainIds = mainThread.map((n) => n.id);
    expect(mainIds[0]).toBe(node1Id);
    expect(mainIds[1]).toBe(node2Id);
    expect(mainIds[2]).toBe(node3Id);
    expect(mainIds[3]).toBe(node4Id);
    const mainContents = mainThread.map((n) => n.content);
    expect(mainContents[0]).toBe('Message 1');
    expect(mainContents[1]).toBe('Message 2');
    expect(mainContents[2]).toBe('Message 3');
    expect(mainContents[3]).toBe('Message 4 (main only)');

    // ── Assert: fork branch thread has nodes 1, 2, fork-message ─────────────
    expect(forkThread.length).toBe(3);
    const forkIds = forkThread.map((n) => n.id);
    expect(forkIds[0]).toBe(node1Id);
    expect(forkIds[1]).toBe(node2Id);
    expect(forkIds[2]).toBe(forkMsgId);
    const forkContents = forkThread.map((n) => n.content);
    expect(forkContents[0]).toBe('Message 1');
    expect(forkContents[1]).toBe('Message 2');
    expect(forkContents[2]).toBe('Fork message');

    // ── Assert: fork branch thread does NOT contain message 4 ────────────────
    expect(forkIds).not.toContain(node4Id);
    expect(forkContents).not.toContain('Message 4 (main only)');
  });
});
