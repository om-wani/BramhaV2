import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'

/**
 * RLS probe tests — require a running Postgres instance with the migration applied.
 * Skipped automatically when DATABASE_URL is not set (CI without Docker).
 *
 * Probe queries connect as bramha_app (the restricted role subject to RLS) so that
 * policies are actually enforced. Setup/teardown still uses the admin connection to
 * seed and clean test data bypassing RLS.
 */
const DATABASE_URL = process.env['DATABASE_URL']
const runRlsTests = !!DATABASE_URL

function getAppRoleUrl(): string {
  const url = new URL(DATABASE_URL!)
  url.username = 'bramha_app'
  url.password = 'dev_only_app_password'
  return url.toString()
}

describe.skipIf(!runRlsTests)('RLS isolation probes', () => {
  let adminSql: ReturnType<typeof postgres>
  let userAId: string
  let userBId: string
  let projectAId: string

  beforeAll(async () => {
    adminSql = postgres(DATABASE_URL!, { max: 1 })

    // Create two isolated test users
    const [userA] = await adminSql`
      INSERT INTO users (email, display_name, status)
      VALUES ('rls-probe-user-a@test.invalid', 'RLS User A', 'active')
      RETURNING id
    `
    const [userB] = await adminSql`
      INSERT INTO users (email, display_name, status)
      VALUES ('rls-probe-user-b@test.invalid', 'RLS User B', 'active')
      RETURNING id
    `
    userAId = userA!.id as string
    userBId = userB!.id as string

    // Create an org owned by user A
    const [org] = await adminSql`
      INSERT INTO orgs (name, slug, owner_id)
      VALUES ('RLS Probe Org A', 'rls-probe-org-a', ${userAId})
      RETURNING id
    `

    // Create a project in that org
    const [project] = await adminSql`
      INSERT INTO projects (org_id, name)
      VALUES (${org!.id as string}, 'RLS Probe Project A')
      RETURNING id
    `
    projectAId = project!.id as string

    // Add user A as project owner — user B is NOT added
    await adminSql`
      INSERT INTO project_members (project_id, user_id, role)
      VALUES (${projectAId}, ${userAId}, 'owner')
    `
  })

  afterAll(async () => {
    // Clean up test data in dependency order
    await adminSql`DELETE FROM project_members WHERE project_id = ${projectAId}`
    await adminSql`DELETE FROM projects         WHERE id = ${projectAId}`
    await adminSql`DELETE FROM orgs             WHERE slug = 'rls-probe-org-a'`
    await adminSql`DELETE FROM users            WHERE email LIKE 'rls-probe-%@test.invalid'`
    await adminSql.end()
  })

  it('user B cannot SELECT user A project rows', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SET LOCAL app.user_id = ${userBId}`
      await tx`SET LOCAL app.project_id = ''`
      return tx`SELECT id FROM projects WHERE id = ${projectAId}`
    })

    await appSql.end()
    expect(rows).toHaveLength(0)
  })

  it('user A CAN SELECT their own project row', async () => {
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const rows = await appSql.begin(async (tx) => {
      await tx`SET LOCAL app.user_id = ${userAId}`
      await tx`SET LOCAL app.project_id = ${projectAId}`
      return tx`SELECT id FROM projects WHERE id = ${projectAId}`
    })

    await appSql.end()
    expect(rows).toHaveLength(1)
  })

  it('EXPLAIN on projects lookup uses index (idx_projects_org_id or PK)', async () => {
    // Just verifying the plan doesn't sequential-scan the whole table
    const appSql = postgres(getAppRoleUrl(), { max: 1 })

    const [row] = await appSql.begin(async (tx) => {
      await tx`SET LOCAL app.user_id = ${userAId}`
      await tx`SET LOCAL app.project_id = ${projectAId}`
      await tx`SET LOCAL enable_seqscan = off`
      return tx`EXPLAIN (FORMAT JSON) SELECT * FROM projects WHERE id = ${projectAId}`
    })

    await appSql.end()

    const plan = (row as Record<string, unknown>)['QUERY PLAN'] as Array<{
      Plan: { 'Node Type': string }
    }>
    const nodeType = plan[0]?.Plan['Node Type'] ?? ''
    // Should be an Index Scan or Bitmap Index Scan, not a plain Seq Scan
    expect(nodeType).toMatch(/Index|Bitmap/)
  })
})
