/**
 * E2E spec: ConversationsService — concurrent append auto-fork.
 *
 * Requires a running Postgres (with 0006_dag.sql migrated) + Redis.
 * Skipped unless TEST_DATABASE_URL and TEST_REDIS_URL are set.
 *
 * Run manually:
 *   TEST_DATABASE_URL=postgres://... TEST_REDIS_URL=redis://... \
 *     pnpm -F api vitest run conversations.e2e
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const hasEnv = !!process.env['TEST_DATABASE_URL'] && !!process.env['TEST_REDIS_URL']

describe.skipIf(!hasEnv)('ConversationsService — concurrent append auto-fork', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let withTenantFn: ((fn: (tx: any) => Promise<any>, ctx: { userId: string; projectId?: string }) => Promise<any>) | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let redis: any
  let service: import('./conversations.service.js').ConversationsService

  let projectId: string
  let roomId: string
  let userId: string

  beforeAll(async () => {
    const { withTenant } = await import('@bramha/db')
    const { Redis } = await import('ioredis')
    withTenantFn = withTenant as typeof withTenantFn

    redis = new Redis(process.env['TEST_REDIS_URL']!)

    // Minimal RlsDbService stub
    const RlsDbServiceStub = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      run: <T>(ctx: { userId: string; projectId?: string }, fn: (tx: any) => Promise<T>) =>
        withTenant(fn, ctx),
    }

    const { ConversationsService } = await import('./conversations.service.js')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ConversationsService(RlsDbServiceStub as any, redis)

    // Seed: org → user → project → project_member → room
    const seed = await withTenant(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (tx: any) => {
        const org = await tx<{ id: string }[]>`
          INSERT INTO orgs (name, slug) VALUES ('e2e-org', ${'e2e-org-' + Date.now()}) RETURNING id
        `
        const orgId = org[0].id as string

        const user = await tx<{ id: string }[]>`
          INSERT INTO users (email, password_hash, display_name)
          VALUES (${'e2e-' + Date.now() + '@test.com'}, 'x', 'E2E User')
          RETURNING id
        `
        const uid = user[0].id as string

        await tx`INSERT INTO org_members (org_id, user_id, role) VALUES (${orgId}, ${uid}, 'owner')`

        const project = await tx<{ id: string }[]>`
          INSERT INTO projects (org_id, name) VALUES (${orgId}, 'e2e-project') RETURNING id
        `
        const pid = project[0].id as string

        await tx`INSERT INTO project_members (project_id, user_id, role) VALUES (${pid}, ${uid}, 'owner')`

        const room = await tx<{ id: string }[]>`
          INSERT INTO rooms (project_id, type, name, created_by)
          VALUES (${pid}, 'meeting', 'e2e-room', ${uid})
          RETURNING id
        `

        return { userId: uid, projectId: pid, roomId: room[0].id as string }
      },
      { userId: '00000000-0000-0000-0000-000000000000' },
    )

    userId = seed.userId
    projectId = seed.projectId
    roomId = seed.roomId
  })

  afterAll(async () => {
    if (projectId && withTenantFn) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await withTenantFn(async (tx: any) => {
        await tx`DELETE FROM projects WHERE id = ${projectId}`
      }, { userId })
    }
    if (redis) await redis.quit()
  })

  it(
    'no lost writes across 100 concurrent-append iterations',
    async () => {
      for (let i = 0; i < 100; i++) {
        // Fresh conversation + branch per iteration so heads are independent
        const conv = await service.create(userId, projectId, roomId, {
          title: `Concurrent test ${i}`,
        })
        const mainBranch = conv.branches[0]!
        const convId = conv.id
        const ts = `${Date.now()}-${i}`

        // Simultaneously append 2 nodes to the same branch head
        const [node1, node2] = await Promise.all([
          service.appendNode(userId, projectId, roomId, convId, {
            branchId: mainBranch.id,
            type: 'user_message',
            authorKind: 'user',
            content: { text: `First-${i}`, mentions: [], attachments: [], meta: {} },
            idempotencyKey: `concurrent-a-${ts}`,
          }),
          service.appendNode(userId, projectId, roomId, convId, {
            branchId: mainBranch.id,
            type: 'user_message',
            authorKind: 'user',
            content: { text: `Second-${i}`, mentions: [], attachments: [], meta: {} },
            idempotencyKey: `concurrent-b-${ts}`,
          }),
        ])

        // Both nodes distinct — no write lost
        expect(node1.id).not.toBe(node2.id)

        // At least 1 branch exists; if conflict occurred there will be 2
        const branches = await service.listBranches(userId, projectId, roomId, convId)
        expect(branches.length).toBeGreaterThanOrEqual(1)

        // Both node IDs appear in graph
        const graph = await service.getGraph(userId, projectId, roomId, convId, {})
        const graphNodeIds = graph.nodes.map((n) => n.id)
        expect(graphNodeIds).toContain(node1.id)
        expect(graphNodeIds).toContain(node2.id)
      }

      vi.resetAllMocks()
    },
    120_000,
  )

  it('idempotency: replaying same key returns cached node without double-insert', async () => {
    const conv = await service.create(userId, projectId, roomId, { title: 'Idempotency test' })
    const branch = conv.branches[0]!
    const convId = conv.id
    const idemKey = `idem-test-${Date.now()}`

    const first = await service.appendNode(userId, projectId, roomId, convId, {
      branchId: branch.id,
      type: 'user_message',
      authorKind: 'user',
      content: { text: 'Hello', mentions: [], attachments: [], meta: {} },
      idempotencyKey: idemKey,
    })

    const second = await service.appendNode(userId, projectId, roomId, convId, {
      branchId: branch.id,
      type: 'user_message',
      authorKind: 'user',
      content: { text: 'Hello', mentions: [], attachments: [], meta: {} },
      idempotencyKey: idemKey,
    })

    // Same node returned
    expect(first.id).toBe(second.id)

    // Only 1 new node inserted (root + 1 = 2 total)
    const graph = await service.getGraph(userId, projectId, roomId, convId, {})
    expect(graph.nodes.length).toBe(2)
  })

  it('fork: creates a new branch at the specified node', async () => {
    const conv = await service.create(userId, projectId, roomId, { title: 'Fork test' })
    const branch = conv.branches[0]!
    const convId = conv.id

    const node = await service.appendNode(userId, projectId, roomId, convId, {
      branchId: branch.id,
      type: 'user_message',
      authorKind: 'user',
      content: { text: 'Message to fork from', mentions: [], attachments: [], meta: {} },
      idempotencyKey: `fork-test-${Date.now()}`,
    })

    const forked = await service.fork(userId, projectId, roomId, convId, {
      fromNodeId: node.id,
      name: 'my-fork',
    })

    expect(forked.name).toBe('my-fork')
    expect(forked.headNodeId).toBe(node.id)
    expect(forked.forkedFromNode).toBe(node.id)

    const branches = await service.listBranches(userId, projectId, roomId, convId)
    expect(branches.find((b) => b.name === 'my-fork')).toBeDefined()
  })
})
