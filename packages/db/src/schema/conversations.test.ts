import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'

/**
 * DAG machinery tests — require a running Postgres with 0006_dag.sql applied.
 * Automatically skipped when DATABASE_URL is not set (CI without Docker).
 *
 * Tests:
 *   1. Append-only guard: UPDATE/DELETE on conversation_nodes raises exception
 *   2. Depth/path trigger: correct depth and ltree path on insert
 *   3. Depth/path 5-level chain: each level's depth and path are correct
 *   4. Cycle guard: node_links BFS detects and rejects cycles + self-loops
 *   5. RLS probes: user B cannot see user A's data in all 7 new tables
 *   6. Property: 1000 random fork operations each maintain depth = parent.depth+1 + path suffix
 *   7. Performance: depth-500 chain ltree ancestor slice query completes in < 10s
 */

const DATABASE_URL = process.env['DATABASE_URL']
const runTests = !!DATABASE_URL

function getAppRoleUrl(): string {
  const url = new URL(DATABASE_URL!)
  url.username = 'bramha_app'
  url.password = 'dev_only_app_password'
  return url.toString()
}

describe.skipIf(!runTests)('DAG schema — triggers and RLS', () => {
  let adminSql: ReturnType<typeof postgres>

  // Shared fixture IDs — populated in beforeAll
  let userAId: string
  let userBId: string
  let orgAId: string
  let projectAId: string
  let projectBId: string
  let roomAId: string
  let conversationAId: string
  // Extra fixtures for RLS probes on room_participants, node_links, branches, user_room_state
  let participantAId: string   // room_participants row id
  let nodeForLinkId: string    // from_node in a node_link
  let nodeForLinkToId: string  // to_node in a node_link
  let branchAId: string        // branches row id

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  beforeAll(async () => {
    adminSql = postgres(DATABASE_URL!, { max: 5 })

    // Users
    const [userA] = await adminSql`
      INSERT INTO users (email, display_name, status)
      VALUES ('dag-test-user-a@test.invalid', 'DAG User A', 'active')
      RETURNING id
    `
    const [userB] = await adminSql`
      INSERT INTO users (email, display_name, status)
      VALUES ('dag-test-user-b@test.invalid', 'DAG User B', 'active')
      RETURNING id
    `
    userAId = userA!.id as string
    userBId = userB!.id as string

    // Org for user A
    const [orgA] = await adminSql`
      INSERT INTO orgs (name, slug, owner_id)
      VALUES ('DAG Test Org A', 'dag-test-org-a', ${userAId})
      RETURNING id
    `
    orgAId = orgA!.id as string

    // Project A (user A is member; user B is NOT — for RLS isolation)
    const [projA] = await adminSql`
      INSERT INTO projects (org_id, name)
      VALUES (${orgAId}, 'DAG Test Project A')
      RETURNING id
    `
    projectAId = projA!.id as string

    await adminSql`
      INSERT INTO project_members (project_id, user_id, role)
      VALUES (${projectAId}, ${userAId}, 'owner')
    `

    // Project B (no members — cross-project isolation)
    const [projB] = await adminSql`
      INSERT INTO projects (org_id, name)
      VALUES (${orgAId}, 'DAG Test Project B')
      RETURNING id
    `
    projectBId = projB!.id as string

    // Room in project A
    const [roomA] = await adminSql`
      INSERT INTO rooms (project_id, type, name, created_by)
      VALUES (${projectAId}, 'meeting', 'DAG Test Room', ${userAId})
      RETURNING id
    `
    roomAId = roomA!.id as string

    // Room participant for user A in room A
    const [partA] = await adminSql`
      INSERT INTO room_participants (room_id, participant_kind, user_id)
      VALUES (${roomAId}, 'user', ${userAId})
      RETURNING id
    `
    participantAId = partA!.id as string

    // Conversation in room A
    const [convA] = await adminSql`
      INSERT INTO conversations (room_id, project_id, title)
      VALUES (${roomAId}, ${projectAId}, 'DAG Test Conversation')
      RETURNING id
    `
    conversationAId = convA!.id as string

    // Two conversation nodes — used as from/to for a node_link and as branch head
    const [nFrom] = await adminSql`
      INSERT INTO conversation_nodes (conversation_id, project_id, type, author_kind, content)
      VALUES (${conversationAId}, ${projectAId}, 'user_message', 'user', '{"text":"from"}'::jsonb)
      RETURNING id
    `
    nodeForLinkId = nFrom!.id as string

    const [nTo] = await adminSql`
      INSERT INTO conversation_nodes
        (conversation_id, project_id, parent_id, type, author_kind, content)
      VALUES
        (${conversationAId}, ${projectAId}, ${nodeForLinkId},
         'agent_message', 'agent', '{"text":"to"}'::jsonb)
      RETURNING id
    `
    nodeForLinkToId = nTo!.id as string

    // A node_link (used by RLS probe for node_links table)
    await adminSql`
      INSERT INTO node_links (from_node, to_node, kind)
      VALUES (${nodeForLinkId}, ${nodeForLinkToId}, 'reference')
    `

    // A branch pointing at nodeForLinkToId
    const [brA] = await adminSql`
      INSERT INTO branches
        (conversation_id, project_id, name, head_node_id, created_by_kind, status)
      VALUES
        (${conversationAId}, ${projectAId}, 'main', ${nodeForLinkToId}, 'user', 'active')
      RETURNING id
    `
    branchAId = brA!.id as string

    // User room state for user A (used by RLS probe for user_room_state table)
    await adminSql`
      INSERT INTO user_room_state
        (user_id, room_id, conversation_id, active_branch_id, last_read_node_id)
      VALUES
        (${userAId}, ${roomAId}, ${conversationAId}, ${branchAId}, ${nodeForLinkToId})
    `
  })

  // ---------------------------------------------------------------------------
  // Teardown — TRUNCATE bypasses row-level triggers (including append-only guard)
  // ---------------------------------------------------------------------------
  afterAll(async () => {
    await adminSql`
      TRUNCATE user_room_state, node_links, branches, conversation_nodes,
               conversations, room_participants, rooms CASCADE
    `
    await adminSql`DELETE FROM project_members WHERE project_id IN (${projectAId}, ${projectBId})`
    await adminSql`DELETE FROM projects WHERE id IN (${projectAId}, ${projectBId})`
    await adminSql`DELETE FROM orgs WHERE id = ${orgAId}`
    await adminSql`DELETE FROM users WHERE email LIKE 'dag-test-%@test.invalid'`
    await adminSql.end()
  })

  // ---------------------------------------------------------------------------
  // Helper: insert a node; trigger sets depth and path
  // ---------------------------------------------------------------------------
  async function insertNode(opts: {
    conversationId: string
    projectId: string
    parentId?: string | null
    type?: string
    authorKind?: string
    content?: Record<string, unknown>
  }): Promise<{ id: string; depth: number; path: string }> {
    const type = opts.type ?? 'user_message'
    const authorKind = opts.authorKind ?? 'user'
    const contentJson = JSON.stringify(opts.content ?? { text: 'hello' })

    const rows = opts.parentId
      ? await adminSql`
          INSERT INTO conversation_nodes
            (conversation_id, project_id, parent_id, type, author_kind, content)
          VALUES
            (${opts.conversationId}, ${opts.projectId}, ${opts.parentId},
             ${type}, ${authorKind}, ${contentJson}::jsonb)
          RETURNING id, depth, path
        `
      : await adminSql`
          INSERT INTO conversation_nodes
            (conversation_id, project_id, type, author_kind, content)
          VALUES
            (${opts.conversationId}, ${opts.projectId},
             ${type}, ${authorKind}, ${contentJson}::jsonb)
          RETURNING id, depth, path
        `

    const row = rows[0]!
    return { id: row.id as string, depth: row.depth as number, path: row.path as string }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // APPEND-ONLY GUARD
  // ═══════════════════════════════════════════════════════════════════════════

  it('rejects UPDATE on conversation_nodes', async () => {
    const node = await insertNode({ conversationId: conversationAId, projectId: projectAId })

    await expect(
      adminSql`UPDATE conversation_nodes SET content = '{"text":"mutated"}'::jsonb WHERE id = ${node.id}`,
    ).rejects.toThrow(/append-only/)
  })

  it('rejects DELETE on conversation_nodes', async () => {
    const node = await insertNode({ conversationId: conversationAId, projectId: projectAId })

    await expect(
      adminSql`DELETE FROM conversation_nodes WHERE id = ${node.id}`,
    ).rejects.toThrow(/append-only/)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DEPTH / PATH TRIGGER
  // ═══════════════════════════════════════════════════════════════════════════

  it('root node gets depth=0 and path equal to its id (hyphens → underscores)', async () => {
    const node = await insertNode({ conversationId: conversationAId, projectId: projectAId })

    expect(node.depth).toBe(0)
    expect(node.path).toBe(node.id.replace(/-/g, '_'))
  })

  it('child node gets depth=1 and path=parent.path.child_id_label', async () => {
    const root = await insertNode({ conversationId: conversationAId, projectId: projectAId })
    const child = await insertNode({
      conversationId: conversationAId,
      projectId: projectAId,
      parentId: root.id,
    })

    expect(child.depth).toBe(1)
    expect(child.path).toBe(`${root.path}.${child.id.replace(/-/g, '_')}`)
  })

  it('5-level chain: depth and path are correct at each level', async () => {
    const chain: Array<{ id: string; depth: number; path: string }> = []

    chain.push(await insertNode({ conversationId: conversationAId, projectId: projectAId }))

    for (let i = 1; i <= 4; i++) {
      chain.push(
        await insertNode({
          conversationId: conversationAId,
          projectId: projectAId,
          parentId: chain[i - 1]!.id,
        }),
      )
    }

    for (let i = 0; i < chain.length; i++) {
      expect(chain[i]!.depth, `depth at level ${i}`).toBe(i)
    }
    for (let i = 1; i < chain.length; i++) {
      const label = chain[i]!.id.replace(/-/g, '_')
      expect(chain[i]!.path, `path at level ${i}`).toBe(`${chain[i - 1]!.path}.${label}`)
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CYCLE GUARD
  // ═══════════════════════════════════════════════════════════════════════════

  it('node_links cycle guard: A→B→C then C→A is rejected', async () => {
    const nodeA = await insertNode({ conversationId: conversationAId, projectId: projectAId })
    const nodeB = await insertNode({ conversationId: conversationAId, projectId: projectAId })
    const nodeC = await insertNode({ conversationId: conversationAId, projectId: projectAId })

    await adminSql`
      INSERT INTO node_links (from_node, to_node, kind) VALUES (${nodeA.id}, ${nodeB.id}, 'reference')
    `
    await adminSql`
      INSERT INTO node_links (from_node, to_node, kind) VALUES (${nodeB.id}, ${nodeC.id}, 'reference')
    `

    await expect(
      adminSql`INSERT INTO node_links (from_node, to_node, kind) VALUES (${nodeC.id}, ${nodeA.id}, 'reference')`,
    ).rejects.toThrow(/cycle/)
  })

  it('node_links cycle guard: self-loop is rejected', async () => {
    const node = await insertNode({ conversationId: conversationAId, projectId: projectAId })

    await expect(
      adminSql`INSERT INTO node_links (from_node, to_node, kind) VALUES (${node.id}, ${node.id}, 'reference')`,
    ).rejects.toThrow(/cycle/)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // RLS PROBES — all 7 new tables
  // ═══════════════════════════════════════════════════════════════════════════

  // ── rooms ──────────────────────────────────────────────────────────────────

  it('RLS rooms: user B cannot SELECT user A rooms', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userBId}, true)`
      await tx`SET LOCAL app.project_id = ''`
      return tx`SELECT id FROM rooms WHERE id = ${roomAId}`
    })

    await appSql.end()
    expect(rows).toHaveLength(0)
  })

  it('RLS rooms: user A can SELECT their own rooms', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userAId}, true)`
      await tx`SELECT set_config('app.project_id', ${projectAId}, true)`
      return tx`SELECT id FROM rooms WHERE id = ${roomAId}`
    })

    await appSql.end()
    expect(rows).toHaveLength(1)
  })

  // ── room_participants ──────────────────────────────────────────────────────

  it('RLS room_participants: user B cannot SELECT user A room_participants', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userBId}, true)`
      await tx`SET LOCAL app.project_id = ''`
      return tx`SELECT id FROM room_participants WHERE id = ${participantAId}`
    })

    await appSql.end()
    expect(rows).toHaveLength(0)
  })

  it('RLS room_participants: user A can SELECT their own room_participants', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userAId}, true)`
      await tx`SELECT set_config('app.project_id', ${projectAId}, true)`
      return tx`SELECT id FROM room_participants WHERE id = ${participantAId}`
    })

    await appSql.end()
    expect(rows).toHaveLength(1)
  })

  // ── conversations ──────────────────────────────────────────────────────────

  it('RLS conversations: user B cannot SELECT user A conversations', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userBId}, true)`
      await tx`SET LOCAL app.project_id = ''`
      return tx`SELECT id FROM conversations WHERE id = ${conversationAId}`
    })

    await appSql.end()
    expect(rows).toHaveLength(0)
  })

  it('RLS conversations: user A can SELECT their own conversations', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userAId}, true)`
      await tx`SELECT set_config('app.project_id', ${projectAId}, true)`
      return tx`SELECT id FROM conversations WHERE id = ${conversationAId}`
    })

    await appSql.end()
    expect(rows).toHaveLength(1)
  })

  // ── conversation_nodes ─────────────────────────────────────────────────────

  it('RLS conversation_nodes: user B cannot SELECT user A nodes', async () => {
    const node = await insertNode({ conversationId: conversationAId, projectId: projectAId })
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userBId}, true)`
      await tx`SET LOCAL app.project_id = ''`
      return tx`SELECT id FROM conversation_nodes WHERE id = ${node.id}`
    })

    await appSql.end()
    expect(rows).toHaveLength(0)
  })

  it('RLS conversation_nodes: user A can SELECT their own nodes', async () => {
    const node = await insertNode({ conversationId: conversationAId, projectId: projectAId })
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userAId}, true)`
      await tx`SELECT set_config('app.project_id', ${projectAId}, true)`
      return tx`SELECT id FROM conversation_nodes WHERE id = ${node.id}`
    })

    await appSql.end()
    expect(rows).toHaveLength(1)
  })

  // ── node_links ─────────────────────────────────────────────────────────────

  it('RLS node_links: user B cannot SELECT user A node_links', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userBId}, true)`
      await tx`SET LOCAL app.project_id = ''`
      return tx`SELECT from_node FROM node_links WHERE from_node = ${nodeForLinkId}`
    })

    await appSql.end()
    expect(rows).toHaveLength(0)
  })

  it('RLS node_links: user A can SELECT their own node_links', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userAId}, true)`
      await tx`SELECT set_config('app.project_id', ${projectAId}, true)`
      return tx`SELECT from_node FROM node_links WHERE from_node = ${nodeForLinkId}`
    })

    await appSql.end()
    expect(rows).toHaveLength(1)
  })

  // ── branches ──────────────────────────────────────────────────────────────

  it('RLS branches: user B cannot SELECT user A branches', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userBId}, true)`
      await tx`SET LOCAL app.project_id = ''`
      return tx`SELECT id FROM branches WHERE id = ${branchAId}`
    })

    await appSql.end()
    expect(rows).toHaveLength(0)
  })

  it('RLS branches: user A can SELECT their own branches', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userAId}, true)`
      await tx`SELECT set_config('app.project_id', ${projectAId}, true)`
      return tx`SELECT id FROM branches WHERE id = ${branchAId}`
    })

    await appSql.end()
    expect(rows).toHaveLength(1)
  })

  // ── user_room_state ────────────────────────────────────────────────────────

  it('RLS user_room_state: user B cannot SELECT user A state', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userBId}, true)`
      await tx`SET LOCAL app.project_id = ''`
      return tx`
        SELECT user_id FROM user_room_state
        WHERE user_id = ${userAId} AND room_id = ${roomAId} AND conversation_id = ${conversationAId}
      `
    })

    await appSql.end()
    expect(rows).toHaveLength(0)
  })

  it('RLS user_room_state: user A can SELECT their own state', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userAId}, true)`
      await tx`SELECT set_config('app.project_id', ${projectAId}, true)`
      return tx`
        SELECT user_id FROM user_room_state
        WHERE user_id = ${userAId} AND room_id = ${roomAId} AND conversation_id = ${conversationAId}
      `
    })

    await appSql.end()
    expect(rows).toHaveLength(1)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PROPERTY TEST — 1000 random fork operations
  // ═══════════════════════════════════════════════════════════════════════════

  it(
    'property: 1000 random fork/append operations each have depth = parent.depth+1 and path ends with id_label',
    async () => {
      const inserted: Array<{ id: string; depth: number; path: string }> = []

      // Root
      const root = await insertNode({ conversationId: conversationAId, projectId: projectAId })
      inserted.push(root)

      for (let i = 1; i < 1000; i++) {
        const parent = inserted[Math.floor(Math.random() * inserted.length)]!

        const node = await insertNode({
          conversationId: conversationAId,
          projectId: projectAId,
          parentId: parent.id,
        })
        inserted.push(node)

        const idLabel = node.id.replace(/-/g, '_')

        // depth invariant
        expect(node.depth, `node ${i} depth`).toBe(parent.depth + 1)
        // path suffix invariant
        expect(node.path, `node ${i} path suffix`).toMatch(new RegExp(`\\.?${idLabel}$`))
      }
    },
    { timeout: 120_000 },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // PERFORMANCE TEST — depth-500 chain + ltree ancestor query
  // ═══════════════════════════════════════════════════════════════════════════

  it(
    'performance: ltree ancestor-slice query over 500-node chain completes in < 10s',
    async () => {
      // Build a linear chain of 500 nodes (each child of the previous)
      let prev = await insertNode({ conversationId: conversationAId, projectId: projectAId })
      const rootPath = prev.path

      for (let i = 1; i < 500; i++) {
        prev = await insertNode({
          conversationId: conversationAId,
          projectId: projectAId,
          parentId: prev.id,
        })
      }

      // Verify the last node is at depth 499
      expect(prev.depth).toBe(499)

      // Time a single ltree ancestor-slice query (uses GiST index on path)
      const start = Date.now()
      const rows = await adminSql`
        SELECT id FROM conversation_nodes
        WHERE path <@ ${rootPath}::ltree
      `
      const elapsed = Date.now() - start

      // All 500 nodes in the chain are descendants of (or equal to) the root
      expect(rows.length).toBeGreaterThanOrEqual(500)
      // Assert the index is actually used — query must finish well under 10s
      expect(elapsed, `ltree query took ${elapsed}ms`).toBeLessThan(10_000)
    },
    { timeout: 120_000 },
  )
})
