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
 *   4. Cycle guard: node_links DFS detects and rejects cycles
 *   5. RLS probe: user B cannot see user A's rooms/conversations/nodes
 *   6. Property: 20 random fork operations each maintain depth = parent.depth + 1
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

  // Shared test fixture IDs
  let userAId: string
  let userBId: string
  let orgAId: string
  let projectAId: string
  let projectBId: string
  let roomAId: string
  let conversationAId: string

  // ---------------------------------------------------------------------------
  // Setup: create isolated users, projects, rooms, conversations
  // ---------------------------------------------------------------------------
  beforeAll(async () => {
    adminSql = postgres(DATABASE_URL!, { max: 3 })

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

    // Project A (user A is member; user B is NOT)
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

    // Project B (for RLS cross-project isolation)
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

    // Conversation in room A
    const [convA] = await adminSql`
      INSERT INTO conversations (room_id, project_id, title)
      VALUES (${roomAId}, ${projectAId}, 'DAG Test Conversation')
      RETURNING id
    `
    conversationAId = convA!.id as string
  })

  // ---------------------------------------------------------------------------
  // Teardown: TRUNCATE DAG tables (TRUNCATE bypasses row-level triggers,
  // so the append-only guard does not block cleanup).
  // ---------------------------------------------------------------------------
  afterAll(async () => {
    // Truncate all DAG tables in reverse dependency order.
    // CASCADE handles any remaining FK refs automatically.
    await adminSql`
      TRUNCATE user_room_state, node_links, branches, conversation_nodes,
               conversations, room_participants, rooms CASCADE
    `

    // Clean up identity fixture data
    await adminSql`DELETE FROM project_members WHERE project_id IN (${projectAId}, ${projectBId})`
    await adminSql`DELETE FROM projects WHERE id IN (${projectAId}, ${projectBId})`
    await adminSql`DELETE FROM orgs WHERE id = ${orgAId}`
    await adminSql`DELETE FROM users WHERE email LIKE 'dag-test-%@test.invalid'`

    await adminSql.end()
  })

  // ---------------------------------------------------------------------------
  // Helper: insert a node without specifying depth/path (trigger sets them).
  // Content is JSON-serialised as a string and cast to jsonb in SQL to avoid
  // postgres.js JSONValue type constraints in the test helper signature.
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

  // ---------------------------------------------------------------------------
  // 1. Append-only: UPDATE raises exception
  // ---------------------------------------------------------------------------
  it('rejects UPDATE on conversation_nodes', async () => {
    const node = await insertNode({
      conversationId: conversationAId,
      projectId: projectAId,
    })

    await expect(
      adminSql`UPDATE conversation_nodes SET content = '{"text":"mutated"}'::jsonb WHERE id = ${node.id}`,
    ).rejects.toThrow(/append-only/)
  })

  // ---------------------------------------------------------------------------
  // 2. Append-only: DELETE raises exception
  // ---------------------------------------------------------------------------
  it('rejects DELETE on conversation_nodes', async () => {
    const node = await insertNode({
      conversationId: conversationAId,
      projectId: projectAId,
    })

    await expect(
      adminSql`DELETE FROM conversation_nodes WHERE id = ${node.id}`,
    ).rejects.toThrow(/append-only/)
  })

  // ---------------------------------------------------------------------------
  // 3. Depth/path: root node gets depth=0, path=<id-with-underscores>
  // ---------------------------------------------------------------------------
  it('root node gets depth=0 and path equal to its id (hyphens → underscores)', async () => {
    const node = await insertNode({
      conversationId: conversationAId,
      projectId: projectAId,
    })

    const expectedPath = node.id.replace(/-/g, '_')

    expect(node.depth).toBe(0)
    expect(node.path).toBe(expectedPath)
  })

  // ---------------------------------------------------------------------------
  // 4. Depth/path: child node gets depth=1, path=parent.path + '.' + child_label
  // ---------------------------------------------------------------------------
  it('child node gets depth=1 and path=parent.path.child_id_label', async () => {
    const root = await insertNode({
      conversationId: conversationAId,
      projectId: projectAId,
    })
    const child = await insertNode({
      conversationId: conversationAId,
      projectId: projectAId,
      parentId: root.id,
    })

    const childLabel = child.id.replace(/-/g, '_')
    const expectedPath = `${root.path}.${childLabel}`

    expect(child.depth).toBe(1)
    expect(child.path).toBe(expectedPath)
  })

  // ---------------------------------------------------------------------------
  // 5. Depth/path: 5-level chain — each node depth = parent.depth + 1
  // ---------------------------------------------------------------------------
  it('5-level chain: each node depth = parent.depth + 1 and path grows correctly', async () => {
    const chain: Array<{ id: string; depth: number; path: string }> = []

    // Root
    chain.push(
      await insertNode({ conversationId: conversationAId, projectId: projectAId }),
    )

    // Children
    for (let i = 1; i <= 4; i++) {
      chain.push(
        await insertNode({
          conversationId: conversationAId,
          projectId: projectAId,
          parentId: chain[i - 1]!.id,
        }),
      )
    }

    // Verify depth
    for (let i = 0; i < chain.length; i++) {
      expect(chain[i]!.depth, `depth at level ${i}`).toBe(i)
    }

    // Verify path: each node's path = parent.path + '.' + id_label
    for (let i = 1; i < chain.length; i++) {
      const label = chain[i]!.id.replace(/-/g, '_')
      const expected = `${chain[i - 1]!.path}.${label}`
      expect(chain[i]!.path, `path at level ${i}`).toBe(expected)
    }
  })

  // ---------------------------------------------------------------------------
  // 6. Cycle guard: A→B→C then C→A raises exception
  // ---------------------------------------------------------------------------
  it('node_links cycle guard: A→B→C then C→A is rejected', async () => {
    const nodeA = await insertNode({ conversationId: conversationAId, projectId: projectAId })
    const nodeB = await insertNode({ conversationId: conversationAId, projectId: projectAId })
    const nodeC = await insertNode({ conversationId: conversationAId, projectId: projectAId })

    // Build chain A→B→C
    await adminSql`
      INSERT INTO node_links (from_node, to_node, kind)
      VALUES (${nodeA.id}, ${nodeB.id}, 'reference')
    `
    await adminSql`
      INSERT INTO node_links (from_node, to_node, kind)
      VALUES (${nodeB.id}, ${nodeC.id}, 'reference')
    `

    // C→A would close the cycle — must be rejected
    await expect(
      adminSql`
        INSERT INTO node_links (from_node, to_node, kind)
        VALUES (${nodeC.id}, ${nodeA.id}, 'reference')
      `,
    ).rejects.toThrow(/cycle/)
  })

  // ---------------------------------------------------------------------------
  // 7. Cycle guard: self-loop is rejected
  // ---------------------------------------------------------------------------
  it('node_links cycle guard: self-loop is rejected', async () => {
    const node = await insertNode({ conversationId: conversationAId, projectId: projectAId })

    await expect(
      adminSql`
        INSERT INTO node_links (from_node, to_node, kind)
        VALUES (${node.id}, ${node.id}, 'reference')
      `,
    ).rejects.toThrow(/cycle/)
  })

  // ---------------------------------------------------------------------------
  // 8. RLS: user B cannot SELECT user A's rooms (different project membership)
  // ---------------------------------------------------------------------------
  it('RLS: user B cannot SELECT user A rooms', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SET LOCAL app.user_id = ${userBId}`
      await tx`SET LOCAL app.project_id = ''`
      return tx`SELECT id FROM rooms WHERE id = ${roomAId}`
    })

    await appSql.end()
    expect(rows).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // 9. RLS: user A CAN SELECT their own rooms
  // ---------------------------------------------------------------------------
  it('RLS: user A can SELECT their own rooms', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SET LOCAL app.user_id = ${userAId}`
      await tx`SET LOCAL app.project_id = ${projectAId}`
      return tx`SELECT id FROM rooms WHERE id = ${roomAId}`
    })

    await appSql.end()
    expect(rows).toHaveLength(1)
  })

  // ---------------------------------------------------------------------------
  // 10. RLS: user B cannot SELECT user A's conversation nodes
  // ---------------------------------------------------------------------------
  it('RLS: user B cannot SELECT conversation_nodes from user A project', async () => {
    // Insert a node as admin (bypasses RLS)
    const node = await insertNode({ conversationId: conversationAId, projectId: projectAId })

    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SET LOCAL app.user_id = ${userBId}`
      await tx`SET LOCAL app.project_id = ''`
      return tx`SELECT id FROM conversation_nodes WHERE id = ${node.id}`
    })

    await appSql.end()
    expect(rows).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // 11. RLS: user A CAN SELECT their own conversation nodes
  // ---------------------------------------------------------------------------
  it('RLS: user A can SELECT their own conversation_nodes', async () => {
    const node = await insertNode({ conversationId: conversationAId, projectId: projectAId })

    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SET LOCAL app.user_id = ${userAId}`
      await tx`SET LOCAL app.project_id = ${projectAId}`
      return tx`SELECT id FROM conversation_nodes WHERE id = ${node.id}`
    })

    await appSql.end()
    expect(rows).toHaveLength(1)
  })

  // ---------------------------------------------------------------------------
  // 12. Property: 20 fork operations each maintain depth = parent.depth + 1
  // ---------------------------------------------------------------------------
  it('property: 20 fork/append operations each have depth = parent.depth + 1', async () => {
    // Build a small tree: root + 19 children each forking from a random ancestor.
    // All nodes inserted via admin SQL; trigger sets depth automatically.

    const inserted: Array<{ id: string; depth: number; parentId: string | null }> = []

    // Root
    const root = await insertNode({ conversationId: conversationAId, projectId: projectAId })
    inserted.push({ id: root.id, depth: root.depth, parentId: null })

    for (let i = 1; i < 20; i++) {
      // Pick a random existing node as parent
      const parentIdx = Math.floor(Math.random() * inserted.length)
      const parent = inserted[parentIdx]!

      const node = await insertNode({
        conversationId: conversationAId,
        projectId: projectAId,
        parentId: parent.id,
      })
      inserted.push({ id: node.id, depth: node.depth, parentId: parent.id })

      expect(node.depth, `node ${i} depth`).toBe(parent.depth + 1)
    }
  })
})
