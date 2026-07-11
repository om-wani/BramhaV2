/**
 * Fixture setup/teardown for the tenant-isolation probe battery.
 *
 * Creates two fully isolated tenants (A and B) using the bramha_migrator role
 * (BYPASSRLS) so RLS policies are never active during seeding.
 *
 * teardownFixtures() deletes all seeded rows in the correct FK-dependency order.
 */

import postgres from 'postgres'
import { generateKeyPair, SignJWT } from 'jose'

// ─────────────────────────────────────────────────────────────────────────────
// Credential constants — read from env so gitleaks doesn't flag literals
// ─────────────────────────────────────────────────────────────────────────────

const MIGRATOR_PASSWORD = process.env['BRAMHA_MIGRATOR_PASSWORD'] ?? 'dev_migrator_pw'

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantFixture {
  userId: string
  orgId: string
  projectId: string
  jwtToken: string
  /** IDs of created rows keyed by table name (for probe targeting). */
  rows: Record<string, string[]>
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Safely extract the first row from a postgres.js result. */
function first<T>(rows: T[]): T {
  const row = rows[0]
  if (row === undefined) throw new Error('Expected at least one row from DB insert')
  return row
}

/**
 * Swap credentials in DATABASE_URL to use the bramha_migrator role.
 * Falls back to the original URL if parsing fails (e.g. non-standard URI).
 */
export function getMigratorUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl)
    url.username = 'bramha_migrator'
    url.password = MIGRATOR_PASSWORD
    return url.toString()
  } catch {
    return databaseUrl
  }
}

// Known global persona UUID seeded in migration 0011
const GLOBAL_CTO_PERSONA_ID = '10000000-0000-0000-0000-000000000002'

// ─────────────────────────────────────────────────────────────────────────────
// Per-tenant seeding
// ─────────────────────────────────────────────────────────────────────────────

async function createTenantData(
  sql: postgres.Sql,
  suffix: string,
  userId: string,
): Promise<{ orgId: string; projectId: string; rows: Record<string, string[]> }> {
  const rows: Record<string, string[]> = {}

  // ── Org ───────────────────────────────────────────────────────────────────
  const orgRows = await sql<{ id: string }[]>`
    INSERT INTO orgs (name, slug, owner_id)
    VALUES (
      ${'Probe Org ' + suffix},
      ${'probe-org-' + suffix},
      ${userId}
    )
    RETURNING id
  `
  const orgId = first(orgRows).id

  await sql`
    INSERT INTO org_members (org_id, user_id, role)
    VALUES (${orgId}, ${userId}, 'owner')
  `

  // ── Project + membership ──────────────────────────────────────────────────
  const projRows = await sql<{ id: string }[]>`
    INSERT INTO projects (org_id, name)
    VALUES (${orgId}, ${'Probe Project ' + suffix})
    RETURNING id
  `
  const projectId = first(projRows).id

  await sql`
    INSERT INTO project_members (project_id, user_id, role)
    VALUES (${projectId}, ${userId}, 'owner')
  `
  rows['project_members'] = [`${projectId}:${userId}`]

  // ── Room ──────────────────────────────────────────────────────────────────
  const roomRows = await sql<{ id: string }[]>`
    INSERT INTO rooms (project_id, type, name, created_by)
    VALUES (${projectId}, 'conference', ${'Probe Room ' + suffix}, ${userId})
    RETURNING id
  `
  const roomId = first(roomRows).id
  rows['rooms'] = [roomId]

  // ── Room participant ──────────────────────────────────────────────────────
  const rpRows = await sql<{ id: string }[]>`
    INSERT INTO room_participants (room_id, participant_kind, user_id)
    VALUES (${roomId}, 'user', ${userId})
    RETURNING id
  `
  rows['room_participants'] = [first(rpRows).id]

  // ── Conversation ──────────────────────────────────────────────────────────
  const convRows = await sql<{ id: string }[]>`
    INSERT INTO conversations (room_id, project_id, title)
    VALUES (${roomId}, ${projectId}, ${'Probe Conv ' + suffix})
    RETURNING id
  `
  const convId = first(convRows).id
  rows['conversations'] = [convId]

  // ── Conversation nodes (append-only) ─────────────────────────────────────
  const node1Rows = await sql<{ id: string }[]>`
    INSERT INTO conversation_nodes
      (conversation_id, project_id, type, author_kind, content)
    VALUES
      (${convId}, ${projectId}, 'user_message', 'user', '{"text":"probe"}'::jsonb)
    RETURNING id
  `
  const node1Id = first(node1Rows).id

  const node2Rows = await sql<{ id: string }[]>`
    INSERT INTO conversation_nodes
      (conversation_id, project_id, parent_id, type, author_kind, content)
    VALUES
      (${convId}, ${projectId}, ${node1Id}, 'agent_message', 'agent', '{"text":"response"}'::jsonb)
    RETURNING id
  `
  const node2Id = first(node2Rows).id
  rows['conversation_nodes'] = [node1Id, node2Id]

  // ── Node link ─────────────────────────────────────────────────────────────
  await sql`
    INSERT INTO node_links (from_node, to_node, kind)
    VALUES (${node1Id}, ${node2Id}, 'reference')
  `
  rows['node_links'] = [`${node1Id}:${node2Id}`]

  // ── Branch ────────────────────────────────────────────────────────────────
  const branchRows = await sql<{ id: string }[]>`
    INSERT INTO branches (conversation_id, project_id, name, head_node_id, created_by_kind)
    VALUES (${convId}, ${projectId}, 'main', ${node2Id}, 'user')
    RETURNING id
  `
  const branchId = first(branchRows).id
  rows['branches'] = [branchId]

  // Set default_branch_id (circular FK — branches must exist first)
  await sql`
    UPDATE conversations SET default_branch_id = ${branchId} WHERE id = ${convId}
  `

  // ── User room state ───────────────────────────────────────────────────────
  await sql`
    INSERT INTO user_room_state (user_id, room_id, conversation_id, active_branch_id)
    VALUES (${userId}, ${roomId}, ${convId}, ${branchId})
  `
  rows['user_room_state'] = [`${userId}:${roomId}`]

  // ── Artifact + version ───────────────────────────────────────────────────
  const artRows = await sql<{ id: string }[]>`
    INSERT INTO artifacts (project_id, created_by_user, kind, title)
    VALUES (${projectId}, ${userId}, 'code', ${'Probe Artifact ' + suffix})
    RETURNING id
  `
  const artId = first(artRows).id
  rows['artifacts'] = [artId]

  await sql`
    INSERT INTO artifact_versions
      (artifact_id, version, content_key, content_sha256, size_bytes)
    VALUES
      (${artId}, 1,
       ${'artifacts/' + projectId + '/' + artId + '/v1'},
       ${'0'.repeat(64)},
       100)
  `
  rows['artifact_versions'] = [`${artId}:1`]

  // ── File ──────────────────────────────────────────────────────────────────
  const fileRows = await sql<{ id: string }[]>`
    INSERT INTO files
      (project_id, uploaded_by, room_id, name, declared_mime, size_bytes, storage_key)
    VALUES
      (${projectId}, ${userId}, ${roomId},
       ${'probe-file-' + suffix + '.txt'}, 'text/plain', 100,
       ${'files/' + projectId + '/probe-' + suffix + '.txt'})
    RETURNING id
  `
  const fileId = first(fileRows).id
  rows['files'] = [fileId]

  // ── Knowledge source ──────────────────────────────────────────────────────
  const ksRows = await sql<{ id: string }[]>`
    INSERT INTO knowledge_sources (project_id, type, config)
    VALUES (${projectId}, 'manual', '{}'::jsonb)
    RETURNING id
  `
  const ksId = first(ksRows).id
  rows['knowledge_sources'] = [ksId]

  // ── Ingestion job ─────────────────────────────────────────────────────────
  const jobRows = await sql<{ id: string }[]>`
    INSERT INTO ingestion_jobs (project_id, kind, file_id, status)
    VALUES (${projectId}, 'file', ${fileId}, 'queued')
    RETURNING id
  `
  rows['ingestion_jobs'] = [first(jobRows).id]

  // ── Knowledge chunk (embedding nullable — no vector required) ─────────────
  const chunkRows = await sql<{ id: string }[]>`
    INSERT INTO knowledge_chunks
      (project_id, origin, origin_id, chunk_index, content, token_count)
    VALUES
      (${projectId}, 'upload', ${fileId}, 0, ${'probe content for ' + suffix}, 4)
    RETURNING id
  `
  rows['knowledge_chunks'] = [first(chunkRows).id]

  // ── Project-scoped agent persona ──────────────────────────────────────────
  const personaRows = await sql<{ id: string }[]>`
    INSERT INTO agent_personas
      (scope, project_id, tier, slug, name, system_prompt_tpl)
    VALUES
      ('project', ${projectId}, 'specialist',
       ${'probe-agent-' + suffix},
       ${'Probe Agent ' + suffix},
       'You are a probe agent.')
    RETURNING id
  `
  const personaId = first(personaRows).id
  rows['agent_personas'] = [personaId]

  // ── Project agent (uses global CTO persona) ───────────────────────────────
  await sql`
    INSERT INTO project_agents (project_id, persona_id)
    VALUES (${projectId}, ${GLOBAL_CTO_PERSONA_ID})
    ON CONFLICT DO NOTHING
  `
  rows['project_agents'] = [`${projectId}:${GLOBAL_CTO_PERSONA_ID}`]

  // ── Agent working memory (uses global CTO persona) ────────────────────────
  await sql`
    INSERT INTO agent_working_memory
      (persona_id, conversation_id, project_id, facts)
    VALUES
      (${GLOBAL_CTO_PERSONA_ID}, ${convId}, ${projectId}, '[]'::jsonb)
    ON CONFLICT DO NOTHING
  `
  rows['agent_working_memory'] = [`${GLOBAL_CTO_PERSONA_ID}:${convId}`]

  // ── Token usage ───────────────────────────────────────────────────────────
  const tuRows = await sql<{ id: string }[]>`
    INSERT INTO token_usage
      (project_id, persona_id, provider, model, input_tokens, output_tokens, estimated_usd)
    VALUES
      (${projectId}, ${GLOBAL_CTO_PERSONA_ID}, 'anthropic', 'claude-test', 100, 50, 0.001)
    RETURNING id
  `
  rows['token_usage'] = [first(tuRows).id]

  // ── Delegation ────────────────────────────────────────────────────────────
  const delRows = await sql<{ id: string }[]>`
    INSERT INTO delegations (project_id, group_id, spec, budget)
    VALUES
      (${projectId}, gen_random_uuid(),
       '{"task":"probe"}'::jsonb,
       '{"limitUsd":1}'::jsonb)
    RETURNING id
  `
  const delId = first(delRows).id
  rows['delegations'] = [delId]

  // ── Approval ──────────────────────────────────────────────────────────────
  const approvalRows = await sql<{ id: string }[]>`
    INSERT INTO approvals
      (project_id, requested_by_persona, delegation_id,
       action_summary, payload_hash, expires_at)
    VALUES
      (${projectId}, ${GLOBAL_CTO_PERSONA_ID}, ${delId},
       'Probe approval action',
       ${'a'.repeat(64)},
       now() + interval '1 hour')
    RETURNING id
  `
  rows['approvals'] = [first(approvalRows).id]

  // ── MCP connector (project-scoped) ────────────────────────────────────────
  const mcpConRows = await sql<{ id: string }[]>`
    INSERT INTO mcp_connectors (project_id, name, slug, manifest)
    VALUES
      (${projectId},
       ${'Probe MCP ' + suffix},
       ${'probe-mcp-' + suffix},
       '{}'::jsonb)
    RETURNING id
  `
  const mcpConId = first(mcpConRows).id
  rows['mcp_connectors'] = [mcpConId]

  // ── MCP grant ─────────────────────────────────────────────────────────────
  const mcpGrantRows = await sql<{ id: string }[]>`
    INSERT INTO mcp_grants
      (project_id, persona_id, connector_id, allowed_scopes)
    VALUES
      (${projectId}, ${GLOBAL_CTO_PERSONA_ID}, ${mcpConId}, ARRAY['read'])
    RETURNING id
  `
  rows['mcp_grants'] = [first(mcpGrantRows).id]

  // ── Graph checkpoint (authenticated-only RLS; no project_id column) ────────
  const checkpointThreadId = `probe-${convId}:${branchId}:${GLOBAL_CTO_PERSONA_ID}:test-turn`
  await sql`
    INSERT INTO graph_checkpoints (thread_id, checkpoint, metadata)
    VALUES (${checkpointThreadId}, '\x00'::bytea, '{}'::jsonb)
  `
  rows['graph_checkpoints'] = [checkpointThreadId]

  // ── Notes ─────────────────────────────────────────────────────────────────
  const note1Rows = await sql<{ id: string }[]>`
    INSERT INTO notes (project_id, author_id, title, content_md)
    VALUES (${projectId}, ${userId}, ${'Probe Note 1 ' + suffix}, 'probe note one')
    RETURNING id
  `
  const note1Id = first(note1Rows).id

  const note2Rows = await sql<{ id: string }[]>`
    INSERT INTO notes (project_id, author_id, title, content_md)
    VALUES (${projectId}, ${userId}, ${'Probe Note 2 ' + suffix}, 'probe note two')
    RETURNING id
  `
  const note2Id = first(note2Rows).id
  rows['notes'] = [note1Id, note2Id]

  // ── Note link ─────────────────────────────────────────────────────────────
  await sql`
    INSERT INTO note_links (from_note, to_note)
    VALUES (${note1Id}, ${note2Id})
  `
  rows['note_links'] = [`${note1Id}:${note2Id}`]

  return { orgId, projectId, rows }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function setupFixtures(): Promise<{
  tenantA: TenantFixture
  tenantB: TenantFixture
}> {
  const DATABASE_URL = process.env['DATABASE_URL']
  if (!DATABASE_URL) throw new Error('DATABASE_URL environment variable is required')

  const migratorUrl = getMigratorUrl(DATABASE_URL)
  const sql = postgres(migratorUrl, { max: 3 })

  try {
    const { privateKey } = await generateKeyPair('EdDSA')
    const ts = Date.now()

    // Create two isolated users (sequential to avoid unique-email conflicts)
    const userARows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name, status)
      VALUES (${'probe-tenant-a-' + ts + '@bramha.test'}, 'Probe Tenant A', 'active')
      RETURNING id
    `
    const userBRows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name, status)
      VALUES (${'probe-tenant-b-' + ts + '@bramha.test'}, 'Probe Tenant B', 'active')
      RETURNING id
    `
    const userAId = first(userARows).id
    const userBId = first(userBRows).id

    // Seed tenant data (sequential — avoids slug index conflicts)
    const dataA = await createTenantData(sql, 'a-' + ts, userAId)
    const dataB = await createTenantData(sql, 'b-' + ts, userBId)

    const signJwt = (userId: string): Promise<string> =>
      new SignJWT({ sub: userId })
        .setProtectedHeader({ alg: 'EdDSA' })
        .setIssuer('bramha')
        .setAudience('bramha-api')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey)

    const [jwtA, jwtB] = await Promise.all([signJwt(userAId), signJwt(userBId)])

    return {
      tenantA: {
        userId: userAId,
        orgId: dataA.orgId,
        projectId: dataA.projectId,
        jwtToken: jwtA,
        rows: dataA.rows,
      },
      tenantB: {
        userId: userBId,
        orgId: dataB.orgId,
        projectId: dataB.projectId,
        jwtToken: jwtB,
        rows: dataB.rows,
      },
    }
  } finally {
    await sql.end()
  }
}

export async function teardownFixtures(fixtures: {
  tenantA: TenantFixture
  tenantB: TenantFixture
}): Promise<void> {
  const DATABASE_URL = process.env['DATABASE_URL']
  if (!DATABASE_URL) throw new Error('DATABASE_URL required for teardownFixtures')

  const { tenantA, tenantB } = fixtures
  const migratorUrl = getMigratorUrl(DATABASE_URL)
  const sql = postgres(migratorUrl, { max: 1 })

  const pIds = sql.array([tenantA.projectId, tenantB.projectId])
  const orgIds = sql.array([tenantA.orgId, tenantB.orgId])
  const userIds = sql.array([tenantA.userId, tenantB.userId])

  try {
    // 1. note_links — no cascade from project; join with notes to identify our rows
    await sql`
      DELETE FROM note_links nl
      USING notes n
      WHERE nl.from_note = n.id
        AND n.project_id = ANY(${pIds}::uuid[])
    `

    // 2. user_room_state — no direct project_id FK; join with rooms
    await sql`
      DELETE FROM user_room_state urs
      USING rooms r
      WHERE urs.room_id = r.id
        AND r.project_id = ANY(${pIds}::uuid[])
    `

    // 3. graph_checkpoints — no project_id; delete by exact thread_ids
    const gcIds = [
      ...(tenantA.rows['graph_checkpoints'] ?? []),
      ...(tenantB.rows['graph_checkpoints'] ?? []),
    ]
    if (gcIds.length > 0) {
      await sql`DELETE FROM graph_checkpoints WHERE thread_id = ANY(${sql.array(gcIds)}::text[])`
    }

    // 4. Break conversations.default_branch_id circular FK before deleting branches
    await sql`
      UPDATE conversations SET default_branch_id = NULL
      WHERE project_id = ANY(${pIds}::uuid[])
    `

    // 5. Delete branches (removes head_node_id refs to conversation_nodes;
    //    required before cascade can delete conversation_nodes)
    await sql`DELETE FROM branches WHERE project_id = ANY(${pIds}::uuid[])`

    // 6. Delete orgs — cascades to:
    //      projects → rooms → conversations → conversation_nodes
    //        (append-only trigger allows: pg_trigger_depth() > 0 during cascade)
    //      projects → files, knowledge_sources, knowledge_chunks, artifacts,
    //                 notes, mcp_connectors, project_agents, agent_working_memory,
    //                 token_usage, delegations, approvals, mcp_grants,
    //                 ingestion_jobs, agent_personas (all via project_id CASCADE)
    await sql`DELETE FROM orgs WHERE id = ANY(${orgIds}::uuid[])`

    // 7. Delete users (after orgs/projects gone; notes.author_id → users RESTRICT
    //    is satisfied because notes cascaded in step 6)
    await sql`DELETE FROM users WHERE id = ANY(${userIds}::uuid[])`
  } finally {
    await sql.end()
  }
}
