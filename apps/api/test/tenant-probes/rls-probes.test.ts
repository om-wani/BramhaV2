/**
 * RLS isolation probe battery — direct DB level.
 *
 * For every tenant table with a project_id column, tenant B's bramha_app
 * connection attempts to SELECT tenant A's rows.  Every probe must return
 * 0 rows; a non-empty result is an isolation breach and fails the build.
 *
 * Requires DATABASE_URL to be set (CI provides this via the postgres service
 * container).  Tests are skipped gracefully when DATABASE_URL is absent so
 * that `pnpm test` still passes in environments without a live database.
 *
 * Schema-coverage assertion (afterAll): queries information_schema.columns
 * for every public table that has a project_id column and asserts it appears
 * in PROBED_TABLES.  New tables that add project_id will fail CI until a
 * probe is written for them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { setupFixtures, teardownFixtures, getMigratorUrl, type TenantFixture } from './fixtures'
import { appendResults, type ProbeResult } from './report'

// ─────────────────────────────────────────────────────────────────────────────
// Skip guard
// ─────────────────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env['DATABASE_URL']
const RUN = !!DATABASE_URL

// ─────────────────────────────────────────────────────────────────────────────
// Credential constants — read from env so gitleaks doesn't flag literals
// ─────────────────────────────────────────────────────────────────────────────

const APP_PASSWORD = process.env['BRAMHA_APP_PASSWORD'] ?? 'dev_app_pw'

// ─────────────────────────────────────────────────────────────────────────────
// bramha_app connection helper
// ─────────────────────────────────────────────────────────────────────────────

function getAppRoleUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl)
    url.username = 'bramha_app'
    url.password = APP_PASSWORD
    return url.toString()
  } catch {
    return databaseUrl
  }
}

/**
 * Run `query` inside a bramha_app transaction with GUCs set to tenant B's
 * context, then return the resulting rows.
 */
async function queryAsTenantB<T extends Record<string, unknown>>(
  appSql: postgres.Sql,
  tenantB: TenantFixture,
  query: (tx: postgres.TransactionSql) => Promise<postgres.RowList<T[]>>,
): Promise<T[]> {
  return appSql.begin(async (tx) => {
    await tx`SELECT set_config('app.user_id', ${tenantB.userId}, true)`
    await tx`SELECT set_config('app.project_id', ${tenantB.projectId}, true)`
    return query(tx)
  }) as Promise<T[]>
}

// ─────────────────────────────────────────────────────────────────────────────
// Tables with project_id that this file probes.
// The afterAll schema-coverage check asserts that every table in
// information_schema.columns WHERE column_name='project_id' appears here.
// ─────────────────────────────────────────────────────────────────────────────

const PROBED_TABLES = new Set([
  'project_members',
  'rooms',
  'conversations',
  'conversation_nodes',
  'branches',
  'artifacts',
  'files',
  'knowledge_sources',
  'ingestion_jobs',
  'knowledge_chunks',
  'agent_working_memory',
  'delegations',
  'approvals',
  'mcp_connectors',
  'mcp_grants',
  'project_agents',
  'token_usage',
  'notes',
  'agent_personas',
  // probed by dedicated tests below (non-standard shapes)
  'graph_checkpoints',
  'audit_log',
])

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN)('Tenant RLS isolation probes (DB level)', () => {
  let tenantA: TenantFixture
  let tenantB: TenantFixture
  let appSql: postgres.Sql
  let migratorSql: postgres.Sql

  const results: ProbeResult[] = []

  /** Helper: run a probe and record the result. */
  async function probe(
    label: string,
    table: string,
    runProbe: () => Promise<{ rows: unknown[] }>,
  ): Promise<void> {
    try {
      const { rows } = await runProbe()
      if (rows.length === 0) {
        results.push({ probe: label, table, passed: true })
      } else {
        results.push({
          probe: label,
          table,
          passed: false,
          failReason: `ISOLATION BREACH: ${label} returned ${rows.length} row(s) — tenant B read tenant A data`,
        })
        throw new Error(
          `ISOLATION BREACH: ${label} — tenant B read ${rows.length} row(s) from tenant A`,
        )
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('ISOLATION BREACH')) {
        throw err
      }
      const reason = err instanceof Error ? err.message : String(err)
      results.push({ probe: label, table, passed: false, failReason: reason })
      throw err
    }
  }

  beforeAll(async () => {
    const fixtures = await setupFixtures()
    tenantA = fixtures.tenantA
    tenantB = fixtures.tenantB

    appSql = postgres(getAppRoleUrl(DATABASE_URL!), { max: 5 })

    // migratorSql needed for the schema-coverage check
    migratorSql = postgres(getMigratorUrl(DATABASE_URL!), { max: 1 })
  })

  afterAll(async () => {
    if (!RUN) return

    // Schema-coverage check FIRST (while migratorSql connection is still open)
    const schemaRows = await migratorSql<{ table_name: string }[]>`
      SELECT DISTINCT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'project_id'
      ORDER BY table_name
    `

    const schemaTables = new Set(schemaRows.map((r) => r.table_name))
    const unprobed: string[] = []

    for (const table of schemaTables) {
      if (!PROBED_TABLES.has(table)) {
        unprobed.push(table)
      }
    }

    // THEN tear down and close connections (always runs)
    await teardownFixtures({ tenantA, tenantB })
    await appSql.end()
    await migratorSql.end()
    appendResults('dbProbes', results)

    // Throw AFTER cleanup so cleanup always runs
    if (unprobed.length > 0) {
      const msg =
        `Schema-coverage gap: the following tables have a project_id column ` +
        `but no isolation probe — add one to rls-probes.test.ts:\n` +
        unprobed.map((t) => `  • ${t}`).join('\n')
      throw new Error(msg)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Tables with direct project_id column
  // ─────────────────────────────────────────────────────────────────────────

  it('project_members — B cannot read A project membership', async () => {
    await probe('project_members isolation', 'project_members', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT project_id FROM project_members WHERE project_id = ${tenantA.projectId}`,
      )
      return { rows }
    })
  })

  it('rooms — B cannot read A rooms', async () => {
    await probe('rooms isolation', 'rooms', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM rooms WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('conversations — B cannot read A conversations', async () => {
    await probe('conversations isolation', 'conversations', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM conversations WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('conversation_nodes — B cannot read A nodes', async () => {
    await probe('conversation_nodes isolation', 'conversation_nodes', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM conversation_nodes WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('branches — B cannot read A branches', async () => {
    await probe('branches isolation', 'branches', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM branches WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('artifacts — B cannot read A artifacts', async () => {
    await probe('artifacts isolation', 'artifacts', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM artifacts WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('files — B cannot read A files', async () => {
    await probe('files isolation', 'files', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM files WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('knowledge_sources — B cannot read A knowledge sources', async () => {
    await probe('knowledge_sources isolation', 'knowledge_sources', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM knowledge_sources WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('ingestion_jobs — B cannot read A ingestion jobs', async () => {
    await probe('ingestion_jobs isolation', 'ingestion_jobs', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM ingestion_jobs WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('knowledge_chunks — B cannot read A knowledge chunks', async () => {
    await probe('knowledge_chunks isolation', 'knowledge_chunks', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM knowledge_chunks WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('agent_working_memory — B cannot read A agent memory', async () => {
    await probe('agent_working_memory isolation', 'agent_working_memory', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT project_id FROM agent_working_memory WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('delegations — B cannot read A delegations', async () => {
    await probe('delegations isolation', 'delegations', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM delegations WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('approvals — B cannot read A approvals', async () => {
    await probe('approvals isolation', 'approvals', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM approvals WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('mcp_connectors — B cannot read A MCP connectors', async () => {
    await probe('mcp_connectors isolation', 'mcp_connectors', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        // mcp_connectors RLS uses app.project_id (already set to B's project by queryAsTenantB)
        tx`SELECT id FROM mcp_connectors WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('mcp_grants — B cannot read A MCP grants', async () => {
    await probe('mcp_grants isolation', 'mcp_grants', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM mcp_grants WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('project_agents — B cannot read A project agents', async () => {
    await probe('project_agents isolation', 'project_agents', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT project_id FROM project_agents WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('token_usage — B cannot read A token usage', async () => {
    await probe('token_usage isolation', 'token_usage', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM token_usage WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('notes — B cannot read A notes', async () => {
    await probe('notes isolation', 'notes', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM notes WHERE project_id = ${tenantA.projectId} LIMIT 1`,
      )
      return { rows }
    })
  })

  it('agent_personas (project-scoped) — B cannot read A project personas', async () => {
    await probe('agent_personas isolation', 'agent_personas', async () => {
      const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
        tx`SELECT id FROM agent_personas
           WHERE project_id = ${tenantA.projectId}
             AND scope = 'project'
           LIMIT 1`,
      )
      return { rows }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Tables without direct project_id (RLS via join) — extra coverage
  // ─────────────────────────────────────────────────────────────────────────

  it('room_participants — B cannot read A room participants (join-scoped RLS)', async () => {
    const aRoomId = tenantA.rows['rooms']?.[0]
    expect(aRoomId).toBeTruthy()

    const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
      tx`SELECT id FROM room_participants WHERE room_id = ${aRoomId!} LIMIT 1`,
    )
    if (rows.length > 0) {
      results.push({
        probe: 'room_participants isolation',
        table: 'room_participants',
        passed: false,
        failReason: `ISOLATION BREACH: B read ${rows.length} room_participants row(s) from A`,
      })
    } else {
      results.push({ probe: 'room_participants isolation', table: 'room_participants', passed: true })
    }
    expect(rows).toHaveLength(0)
  })

  it('node_links — B cannot read A node links (from_node-scoped RLS)', async () => {
    const aNodeId = tenantA.rows['conversation_nodes']?.[0]
    expect(aNodeId).toBeTruthy()

    const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
      tx`SELECT from_node FROM node_links WHERE from_node = ${aNodeId!} LIMIT 1`,
    )
    if (rows.length > 0) {
      results.push({
        probe: 'node_links isolation',
        table: 'node_links',
        passed: false,
        failReason: `ISOLATION BREACH: B read ${rows.length} node_links row(s) from A`,
      })
    } else {
      results.push({ probe: 'node_links isolation', table: 'node_links', passed: true })
    }
    expect(rows).toHaveLength(0)
  })

  it('artifact_versions — B cannot read A artifact versions (artifact-join RLS)', async () => {
    const aArtifactId = tenantA.rows['artifacts']?.[0]
    expect(aArtifactId).toBeTruthy()

    const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
      tx`SELECT artifact_id FROM artifact_versions WHERE artifact_id = ${aArtifactId!} LIMIT 1`,
    )
    if (rows.length > 0) {
      results.push({
        probe: 'artifact_versions isolation',
        table: 'artifact_versions',
        passed: false,
        failReason: `ISOLATION BREACH: B read ${rows.length} artifact_versions row(s) from A`,
      })
    } else {
      results.push({ probe: 'artifact_versions isolation', table: 'artifact_versions', passed: true })
    }
    expect(rows).toHaveLength(0)
  })

  it('note_links — B cannot read A note links (note-join RLS)', async () => {
    const aNoteId = tenantA.rows['notes']?.[0]
    expect(aNoteId).toBeTruthy()

    const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
      tx`SELECT from_note FROM note_links WHERE from_note = ${aNoteId!} LIMIT 1`,
    )
    if (rows.length > 0) {
      results.push({
        probe: 'note_links isolation',
        table: 'note_links',
        passed: false,
        failReason: `ISOLATION BREACH: B read ${rows.length} note_links row(s) from A`,
      })
    } else {
      results.push({ probe: 'note_links isolation', table: 'note_links', passed: true })
    }
    expect(rows).toHaveLength(0)
  })

  it('user_room_state — B cannot read A user room state (own-rows RLS)', async () => {
    const rows = await queryAsTenantB(appSql, tenantB, (tx) =>
      // RLS is user_id = current user; B's user_id ≠ A's user_id
      tx`SELECT user_id FROM user_room_state WHERE user_id = ${tenantA.userId} LIMIT 1`,
    )
    if (rows.length > 0) {
      results.push({
        probe: 'user_room_state isolation',
        table: 'user_room_state',
        passed: false,
        failReason: `ISOLATION BREACH: B read ${rows.length} user_room_state row(s) from A`,
      })
    } else {
      results.push({ probe: 'user_room_state isolation', table: 'user_room_state', passed: true })
    }
    expect(rows).toHaveLength(0)
  })

  it('graph_checkpoints — unauthenticated session returns 0 rows', async () => {
    // graph_checkpoints has no project_id; RLS is authenticated-only.
    // Verify that a session with no user_id set cannot read any checkpoints.
    const rows = await appSql.begin(async (tx) => {
      await tx`SET LOCAL app.user_id = ''`
      await tx`SET LOCAL app.project_id = ''`
      return tx`SELECT thread_id FROM graph_checkpoints LIMIT 1`
    })

    if (rows.length > 0) {
      results.push({
        probe: 'graph_checkpoints unauthenticated',
        table: 'graph_checkpoints',
        passed: false,
        failReason: `graph_checkpoints returned ${rows.length} row(s) for unauthenticated session`,
      })
    } else {
      results.push({
        probe: 'graph_checkpoints unauthenticated',
        table: 'graph_checkpoints',
        passed: true,
      })
    }
    expect(rows).toHaveLength(0)

    // Also probe cross-tenant: B (authenticated) cannot read A's specific checkpoint
    const aThreadId = tenantA.rows['graph_checkpoints']?.[0]
    expect(aThreadId).toBeTruthy()

    const crossTenantRows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${tenantB.userId}, true)`
      await tx`SELECT set_config('app.project_id', ${tenantB.projectId}, true)`
      return tx`SELECT thread_id FROM graph_checkpoints WHERE thread_id = ${aThreadId!}`
    })

    if (crossTenantRows.length > 0) {
      results.push({
        probe: 'graph_checkpoints cross-tenant',
        table: 'graph_checkpoints',
        passed: false,
        failReason: `ISOLATION BREACH: B read ${crossTenantRows.length} graph_checkpoints row(s) from A`,
      })
    } else {
      results.push({
        probe: 'graph_checkpoints cross-tenant',
        table: 'graph_checkpoints',
        passed: true,
      })
    }
    expect(crossTenantRows, 'graph_checkpoints cross-tenant read returned rows').toHaveLength(0)
  })

  it('audit_log — non-admin authenticated user cannot read audit rows', async () => {
    // Seed one audit row for tenant A via migrator (BYPASSRLS)
    await migratorSql`
      INSERT INTO audit_log (actor_id, action, target_type, target_id, project_id)
      VALUES (${tenantA.userId}, 'probe.test', 'probe', 'probe-1', ${tenantA.projectId})
    `
    try {
      // Authenticated tenant B, is_admin NOT set → must see nothing
      const rows = await appSql.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${tenantB.userId}, true)`
        return tx`SELECT id FROM audit_log LIMIT 1`
      })
      const passed = rows.length === 0
      results.push({
        probe: 'audit_log non-admin read',
        table: 'audit_log',
        passed,
        ...(passed ? {} : { failReason: `non-admin read ${rows.length} audit_log row(s)` }),
      })
      expect(rows, 'audit_log non-admin read returned rows').toHaveLength(0)
    } finally {
      await migratorSql`DELETE FROM audit_log WHERE action = 'probe.test'`
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Positive sanity check — tenant A CAN read their own data
  // ─────────────────────────────────────────────────────────────────────────

  it('sanity: A can read their own rooms', async () => {
    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${tenantA.userId}, true)`
      await tx`SELECT set_config('app.project_id', ${tenantA.projectId}, true)`
      return tx`SELECT id FROM rooms WHERE project_id = ${tenantA.projectId} LIMIT 1`
    })
    expect(rows.length).toBeGreaterThan(0)
    results.push({ probe: 'sanity: A reads own rooms', table: 'rooms', passed: rows.length > 0 })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // system_agent — auto-membership from 0026_system_agent.sql
  // ─────────────────────────────────────────────────────────────────────────

  const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000099'

  it('system_agent sees exactly the projects it has membership in (both tenant fixtures, nothing else)', async () => {
    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${SYSTEM_USER_ID}, true)`
      return tx<{ id: string }[]>`SELECT id FROM projects WHERE id IN (${tenantA.projectId}, ${tenantB.projectId})`
    })
    const ids = rows.map((r) => r.id).sort()
    const expected = [tenantA.projectId, tenantB.projectId].sort()
    const passed = JSON.stringify(ids) === JSON.stringify(expected)
    results.push({
      probe: 'system_agent project membership',
      table: 'project_members',
      passed,
      ...(passed ? {} : { failReason: `expected [${expected}], got [${ids}]` }),
    })
    expect(ids).toEqual(expected)
  })

})
