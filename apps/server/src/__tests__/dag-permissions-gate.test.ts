/**
 * Full-app regression gate (real PGlite) for the fixes and features added
 * post-P6:
 *
 * 1. DAG history: user nodes default parent to the branch head — multi-turn
 *    threads survive a "hard refresh" (fresh thread read), regression for the
 *    parentId:null bug that lost all history.
 * 2. Project settings: GET/PATCH /projects/:id/settings roundtrip +
 *    membership guard.
 * 3. Delegation permission endpoints: deny marks pending task failed;
 *    approve fires AgentsService.executeDelegationTask; non-pending → 409;
 *    cross-project access → 404.
 */

import 'reflect-metadata';
process.env['PGLITE_DATA_DIR'] = `memory://dag-perm-gate-${Date.now()}`;
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest';
import fastifyCookie from '@fastify/cookie';
import { migrate, getDb, delegationTasks } from '@bramha/db';
import { eq } from 'drizzle-orm';
import { AuthModule } from '../modules/auth/auth.module.js';
import { OrgsModule } from '../modules/orgs/orgs.module.js';
import { ProjectsModule } from '../modules/projects/projects.module.js';
import { RoomsModule } from '../modules/rooms/rooms.module.js';
import { ConversationModule } from '../modules/conversation/conversation.module.js';
import { AgentsService } from '../modules/agents/agents.service.js';
import { ProblemJsonExceptionFilter } from '../common/filters/problem-json.filter.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

// Stub agents service: no model calls; spy on executeDelegationTask
const agentsServiceStub = {
  triggerAgentTurn: vi.fn().mockResolvedValue([]),
  executeDelegationTask: vi.fn().mockResolvedValue(undefined),
  publicDomainEmbeddings: new Map(),
  onModuleInit: vi.fn(),
};

async function buildApp(): Promise<NestFastifyApplication> {
  await migrate();

  const module = await Test.createTestingModule({
    imports: [AuthModule, OrgsModule, ProjectsModule, RoomsModule, ConversationModule],
  })
    .overrideProvider(AgentsService)
    .useValue(agentsServiceStub)
    .compile();

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
  return `dagperm+${Date.now()}+${++counter}@example.com`;
}

async function registerAndLogin(app: NestFastifyApplication): Promise<string> {
  const email = uniqueEmail();
  const password = 'CorrectHorseBatteryStaple99!';
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, name: 'DAG User', password }),
  });
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const raw = login.headers['set-cookie'];
  const cookieStr = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  return cookieStr.split(';')[0] ?? '';
}

interface Ctx {
  cookie: string;
  projectId: string;
  roomId: string;
  branchId: string;
}

async function setupProjectRoom(app: NestFastifyApplication): Promise<Ctx> {
  const cookie = await registerAndLogin(app);
  const org = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: `Org ${counter}-${Math.random().toString(36).slice(2, 7)}` }),
  });
  const orgId = org.json().id as string;

  const project = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/projects`,
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'Test Project' }),
  });
  const projectId = project.json().id as string;

  const room = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/rooms`,
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'Test Room', kind: 'council' }),
  });
  const roomId = room.json().id as string;

  const branches = await app.inject({
    method: 'GET',
    url: `/projects/${projectId}/rooms/${roomId}/branches`,
    headers: { cookie },
  });
  const branchId = branches.json()[0].id as string;

  return { cookie, projectId, roomId, branchId };
}

describe('DAG + permissions gate', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // 1. DAG history regression
  // -------------------------------------------------------------------------
  it('threads multi-turn history without explicit parentNodeId (parent defaults to head)', async () => {
    const { cookie, projectId, roomId, branchId } = await setupProjectRoom(app);
    const post = (content: string) =>
      app.inject({
        method: 'POST',
        url: `/projects/${projectId}/rooms/${roomId}/nodes`,
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ branchId, content }),
      });

    await post('first message');
    await post('second message');
    await post('third message');

    // "Hard refresh": fresh ancestry read from the head
    const thread = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/rooms/${roomId}/branches/${branchId}/thread`,
      headers: { cookie },
    });
    const nodes = thread.json() as Array<{ content: string; parentId: string | null; id: string }>;

    expect(nodes.map((n) => n.content)).toEqual(['first message', 'second message', 'third message']);
    // Chain check: each node's parent is the previous node
    expect(nodes[0]?.parentId).toBeNull();
    expect(nodes[1]?.parentId).toBe(nodes[0]?.id);
    expect(nodes[2]?.parentId).toBe(nodes[1]?.id);
  });

  // -------------------------------------------------------------------------
  // 2. Project settings
  // -------------------------------------------------------------------------
  it('settings roundtrip: default empty, PATCH merges, non-member 403', async () => {
    const { cookie, projectId } = await setupProjectRoom(app);

    const before = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/settings`,
      headers: { cookie },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({});

    const patch = await app.inject({
      method: 'PATCH',
      url: `/projects/${projectId}/settings`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ delegationMode: 'auto' }),
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toEqual({ delegationMode: 'auto' });

    const after = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/settings`,
      headers: { cookie },
    });
    expect(after.json()).toEqual({ delegationMode: 'auto' });

    // Invalid value rejected by zod
    const bad = await app.inject({
      method: 'PATCH',
      url: `/projects/${projectId}/settings`,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ delegationMode: 'yolo' }),
    });
    expect(bad.statusCode).toBe(400);

    // Non-member cannot read settings
    const stranger = await registerAndLogin(app);
    const denied = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/settings`,
      headers: { cookie: stranger },
    });
    expect([403, 404]).toContain(denied.statusCode);
  });

  // -------------------------------------------------------------------------
  // 3. Delegation approve / deny endpoints
  // -------------------------------------------------------------------------
  async function seedPendingTask(ctx: Ctx): Promise<string> {
    // A source node for the task to hang off
    const node = await app.inject({
      method: 'POST',
      url: `/projects/${ctx.projectId}/rooms/${ctx.roomId}/nodes`,
      headers: { 'content-type': 'application/json', cookie: ctx.cookie },
      body: JSON.stringify({ branchId: ctx.branchId, content: 'delegating message' }),
    });
    const sourceNodeId = node.json().nodeId as string;

    const db = await getDb();
    const [task] = await db
      .insert(delegationTasks)
      .values({
        roomId: ctx.roomId,
        projectId: ctx.projectId,
        sourceNodeId,
        fromPersona: 'ceo',
        toPersona: 'cfo',
        task: 'Analyse the numbers',
        status: 'pending',
      })
      .returning();
    return task!.id;
  }

  it('deny marks a pending task failed; second deny 404s', async () => {
    const ctx = await setupProjectRoom(app);
    const taskId = await seedPendingTask(ctx);

    const deny = await app.inject({
      method: 'POST',
      url: `/projects/${ctx.projectId}/rooms/${ctx.roomId}/delegations/${taskId}/deny`,
      headers: { cookie: ctx.cookie },
    });
    expect(deny.statusCode).toBe(200);

    const db = await getDb();
    const [row] = await db.select().from(delegationTasks).where(eq(delegationTasks.id, taskId));
    expect(row?.status).toBe('failed');

    const again = await app.inject({
      method: 'POST',
      url: `/projects/${ctx.projectId}/rooms/${ctx.roomId}/delegations/${taskId}/deny`,
      headers: { cookie: ctx.cookie },
    });
    expect(again.statusCode).toBe(404);
  });

  it('approve fires executeDelegationTask with the task row data', async () => {
    const ctx = await setupProjectRoom(app);
    const taskId = await seedPendingTask(ctx);
    agentsServiceStub.executeDelegationTask.mockClear();

    const approve = await app.inject({
      method: 'POST',
      url: `/projects/${ctx.projectId}/rooms/${ctx.roomId}/delegations/${taskId}/approve`,
      headers: { 'content-type': 'application/json', cookie: ctx.cookie },
      body: JSON.stringify({ branchId: ctx.branchId }),
    });
    expect(approve.statusCode).toBe(202);
    expect(approve.json()).toEqual({ status: 'running' });

    expect(agentsServiceStub.executeDelegationTask).toHaveBeenCalledTimes(1);
    const arg = agentsServiceStub.executeDelegationTask.mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      taskId,
      projectId: ctx.projectId,
      roomId: ctx.roomId,
      branchId: ctx.branchId,
      fromPersona: 'ceo',
      toPersona: 'cfo',
      task: 'Analyse the numbers',
    });
  });

  it('approve on a non-pending task returns 409', async () => {
    const ctx = await setupProjectRoom(app);
    const taskId = await seedPendingTask(ctx);

    const db = await getDb();
    await db.update(delegationTasks).set({ status: 'done' }).where(eq(delegationTasks.id, taskId));

    const approve = await app.inject({
      method: 'POST',
      url: `/projects/${ctx.projectId}/rooms/${ctx.roomId}/delegations/${taskId}/approve`,
      headers: { 'content-type': 'application/json', cookie: ctx.cookie },
      body: JSON.stringify({ branchId: ctx.branchId }),
    });
    expect(approve.statusCode).toBe(409);
  });

  it('cross-project access to a delegation task 404s', async () => {
    const ctxA = await setupProjectRoom(app);
    const ctxB = await setupProjectRoom(app);
    const taskId = await seedPendingTask(ctxA);

    // ctxB member tries to deny ctxA's task through their own project/room ids
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${ctxB.projectId}/rooms/${ctxB.roomId}/delegations/${taskId}/deny`,
      headers: { cookie: ctxB.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
