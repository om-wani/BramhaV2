/**
 * Agent-runtime entry point.
 *
 * 1. Connect Redis (shared + subscriber connections).
 * 2. Connect Postgres via @bramha/db withTenant (lazy — connection on first query).
 * 3. Subscribe to event bus `conv.node.appended:*` (pattern).
 * 4. Bridge: for each event enqueue a BullMQ job on `conv-events` queue.
 * 5. Start BullMQ Worker consuming `conv-events` → processTurnJob().
 * 6. Graceful shutdown on SIGTERM / SIGINT.
 *
 * Security: DB queries run under SYSTEM_USER_ID (RLS project isolation).
 * Only project-scoped queries use the projectId GUC; cross-project access
 * is structurally impossible because every query supplies a project_id param
 * that must match the RLS-filtered project_id column.
 */

import Redis from 'ioredis'
import { Worker, Queue } from 'bullmq'
import { EventSubscriber, EventPublisher } from '@bramha/event-bus'
import type { ConvNodeAppendedPayload } from '@bramha/event-bus'
import { withTenant } from '@bramha/db'
import type { WorkingMemory } from './pa/working-memory.js'
import type { ScoringNode } from './pa/relevance.js'
import { processTurnJob, type TurnEngineDeps } from './orchestrator/turn-engine.js'
import { createAgentTurnsWorker } from './agent/agent-worker.js'
import { handleInterrupt, type InterruptDeps, type InterruptEvent } from './orchestrator/interrupts.js'

// ── Environment ───────────────────────────────────────────────────────────────

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
const SYSTEM_USER_ID = process.env['SYSTEM_USER_ID']
if (!SYSTEM_USER_ID) {
  throw new Error('SYSTEM_USER_ID environment variable is required')
}

// ── DB dependency implementations ─────────────────────────────────────────────

/**
 * Load room type and full agent roster for a room.
 * Joins rooms → room_participants → project_agents → agent_personas.
 */
async function loadRosterAndRoom(
  roomId: string,
  conversationId: string,
  projectId: string,
) {
  return withTenant(async (tx) => {
    // Load room type + conversation defaultBranchId in one query
    const [roomRow] = await tx<
      Array<{ type: string; default_branch_id: string | null }>
    >`
      SELECT r.type, c.default_branch_id
      FROM rooms r
      JOIN conversations c ON c.id = ${conversationId}
      WHERE r.id = ${roomId}
        AND r.project_id = ${projectId}
      LIMIT 1
    `

    if (!roomRow) {
      return { roomType: 'conference', defaultBranchId: null, agents: [] }
    }

    // Load roster: room_participants → project_agents → agent_personas
    const agentRows = await tx<
      Array<{
        persona_id: string
        slug: string
        name: string
        title: string | null
        expertise_tags: string[]
        speak_profile: Record<string, number>
      }>
    >`
      SELECT ap.id            AS persona_id,
             ap.slug,
             ap.name,
             ap.title,
             ap.expertise_tags,
             ap.speak_profile
      FROM room_participants rp
      JOIN project_agents pa
        ON pa.persona_id = rp.persona_id
       AND pa.project_id = ${projectId}
      JOIN agent_personas ap ON ap.id = rp.persona_id
      WHERE rp.room_id        = ${roomId}
        AND rp.participant_kind = 'agent'
        AND ap.enabled          = TRUE
    `

    const agents = agentRows.map((row) => ({
      personaId: row.persona_id,
      slug: row.slug,
      name: row.name,
      title: row.title ?? row.slug,
      expertiseTags: row.expertise_tags,
      speakProfile: {
        eagerness: (row.speak_profile['eagerness'] as number) ?? 0,
        interruptThreshold: (row.speak_profile['interruptThreshold'] as number) ?? 1.4,
        silenceBias: (row.speak_profile['silenceBias'] as number) ?? 0,
      },
    }))

    return {
      roomType: roomRow.type,
      defaultBranchId: roomRow.default_branch_id,
      agents,
    }
  }, { userId: SYSTEM_USER_ID!, projectId })
}

/**
 * Load the last `limit` conversation nodes before `nodeId`, oldest-first.
 * Used for thread-ownership and recency-fatigue scoring.
 */
async function loadRecentAncestors(
  conversationId: string,
  nodeId: string,
  limit: number,
  projectId: string,
): Promise<ScoringNode[]> {
  return withTenant(async (tx) => {
    const rows = await tx<
      Array<{
        id: string
        content: { text?: string } | null
        type: string
        author_kind: string
        author_persona_id: string | null
      }>
    >`
      SELECT id, content, type, author_kind, author_persona_id
      FROM conversation_nodes
      WHERE conversation_id = ${conversationId}
        AND project_id      = ${projectId}
        AND id              != ${nodeId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `

    // Reverse so oldest is first (expected by scoreAgents)
    return rows.reverse().map((row) => ({
      nodeId: row.id,
      text: (row.content?.text ?? ''),
      type: row.type,
      authorPersonaId: row.author_persona_id,
      embedding: [],
    }))
  }, { userId: SYSTEM_USER_ID!, projectId })
}

/**
 * Load working memories for a set of personas in a conversation.
 * Returns a Map<personaId, WorkingMemory>; missing rows are absent from the map.
 */
async function loadWorkingMemories(
  personaIds: string[],
  conversationId: string,
  projectId: string,
): Promise<Map<string, WorkingMemory>> {
  if (personaIds.length === 0) return new Map()

  return withTenant(async (tx) => {
    const rows = await tx<
      Array<{
        persona_id: string
        facts: WorkingMemory['facts']
        open_loops: WorkingMemory['openLoops']
        last_summary_node: string | null
        summary_md: string | null
        updated_at: string
      }>
    >`
      SELECT persona_id, facts, open_loops, last_summary_node, summary_md,
             updated_at::text AS updated_at
      FROM agent_working_memory
      WHERE persona_id    = ANY(${personaIds}::uuid[])
        AND conversation_id = ${conversationId}
        AND project_id      = ${projectId}
    `

    const map = new Map<string, WorkingMemory>()
    for (const row of rows) {
      map.set(row.persona_id, {
        personaId: row.persona_id,
        conversationId,
        projectId,
        facts: (row.facts as WorkingMemory['facts']) ?? [],
        openLoops: (row.open_loops as WorkingMemory['openLoops']) ?? [],
        lastSummaryNode: row.last_summary_node,
        summaryMd: row.summary_md,
        updatedAt: row.updated_at,
      })
    }
    return map
  }, { userId: SYSTEM_USER_ID!, projectId })
}

/**
 * Upsert a working memory record.
 */
async function upsertWorkingMemory(mem: WorkingMemory): Promise<void> {
  await withTenant(async (tx) => {
    await tx`
      INSERT INTO agent_working_memory
        (persona_id, conversation_id, project_id, facts, open_loops,
         last_summary_node, summary_md, updated_at)
      VALUES (
        ${mem.personaId},
        ${mem.conversationId},
        ${mem.projectId},
        ${JSON.stringify(mem.facts)},
        ${JSON.stringify(mem.openLoops)},
        ${mem.lastSummaryNode ?? null},
        ${mem.summaryMd ?? null},
        ${mem.updatedAt}::timestamptz
      )
      ON CONFLICT (persona_id, conversation_id)
      DO UPDATE SET
        facts             = EXCLUDED.facts,
        open_loops        = EXCLUDED.open_loops,
        last_summary_node = EXCLUDED.last_summary_node,
        summary_md        = EXCLUDED.summary_md,
        updated_at        = EXCLUDED.updated_at
    `
  }, { userId: SYSTEM_USER_ID!, projectId: mem.projectId })
}

/**
 * Query total estimated_usd spent today for the given project.
 */
async function checkDailyUsd(projectId: string): Promise<number> {
  return withTenant(async (tx) => {
    const [row] = await tx<Array<{ total: string }>>`
      SELECT COALESCE(SUM(estimated_usd), 0)::text AS total
      FROM token_usage
      WHERE project_id  = ${projectId}
        AND created_at >= CURRENT_DATE
    `
    return parseFloat(row?.total ?? '0')
  }, { userId: SYSTEM_USER_ID!, projectId })
}

// ── Interrupt engine DB implementations ───────────────────────────────────────

/**
 * Return true if userId is a member (any role) of projectId.
 * Used to authorize stop/redirect interrupts from users.
 */
async function checkProjectMember(userId: string, projectId: string): Promise<boolean> {
  return withTenant(async (tx) => {
    const [row] = await tx<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count
      FROM project_members
      WHERE user_id   = ${userId}::uuid
        AND project_id = ${projectId}::uuid
    `
    return parseInt(row?.count ?? '0') > 0
  }, { userId: SYSTEM_USER_ID!, projectId })
}

/**
 * Return true if personaId (agent) is in the room roster for this conversation.
 * Used to authorize csuite-agent summons.
 */
async function checkRoomMembership(
  personaId: string,
  conversationId: string,
  projectId: string,
): Promise<boolean> {
  return withTenant(async (tx) => {
    const rows = await tx<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count
      FROM room_participants rp
      JOIN conversations c ON c.room_id = rp.room_id
      WHERE c.id            = ${conversationId}::uuid
        AND c.project_id    = ${projectId}::uuid
        AND rp.persona_id   = ${personaId}::uuid
        AND rp.participant_kind = 'agent'
    `
    return parseInt(rows[0]?.count ?? '0') > 0
  }, { userId: SYSTEM_USER_ID!, projectId })
}

/**
 * Mark a branch as abandoned (nearest DB equivalent to 'archived').
 * Called during redirect to retire the current branch.
 */
async function archiveBranch(branchId: string, projectId: string): Promise<void> {
  await withTenant(async (tx) => {
    await tx`
      UPDATE branches
         SET status = 'abandoned'
       WHERE id         = ${branchId}::uuid
         AND project_id = ${projectId}::uuid
    `
  }, { userId: SYSTEM_USER_ID!, projectId })
}

/**
 * Insert a new active branch forked from forkedFromNodeId.
 * Called during redirect to start a fresh conversation thread.
 */
async function createBranch(params: {
  conversationId: string
  projectId: string
  forkedFromNodeId: string
  createdByKind: string
  createdById: string
}): Promise<{ id: string; name: string; headNodeId: string; createdAt: string }> {
  return withTenant(async (tx) => {
    const name = `redirect-${Date.now()}`
    const [row] = await tx<Array<{
      id: string
      name: string
      head_node_id: string
      created_at: string
    }>>`
      INSERT INTO branches
        (conversation_id, project_id, name, head_node_id, forked_from_node,
         created_by_kind, created_by_id, status)
      VALUES (
        ${params.conversationId}::uuid,
        ${params.projectId}::uuid,
        ${name},
        ${params.forkedFromNodeId}::uuid,
        ${params.forkedFromNodeId}::uuid,
        ${params.createdByKind},
        ${params.createdById}::uuid,
        'active'
      )
      RETURNING id, name, head_node_id, created_at::text AS created_at
    `
    return {
      id: row!.id,
      name: row!.name,
      headNodeId: row!.head_node_id,
      createdAt: row!.created_at,
    }
  }, { userId: SYSTEM_USER_ID!, projectId: params.projectId })
}

/**
 * Return the conversation's current head node and its room ID.
 * Resolves via the conversation's default_branch_id → head_node_id.
 */
async function getConversationHeadNode(
  conversationId: string,
  projectId: string,
): Promise<{ nodeId: string; roomId: string; branchId: string | null } | null> {
  return withTenant(async (tx) => {
    const [row] = await tx<Array<{
      room_id: string
      head_node_id: string | null
      branch_id: string | null
    }>>`
      SELECT c.room_id,
             b.head_node_id,
             b.id AS branch_id
      FROM   conversations c
      LEFT JOIN branches b ON b.id = c.default_branch_id
      WHERE  c.id         = ${conversationId}::uuid
        AND  c.project_id = ${projectId}::uuid
      LIMIT 1
    `
    if (!row) return null

    // Fallback: if no default branch, find the latest node in the conversation
    const nodeId = row.head_node_id ?? (await (async () => {
      const [latestNode] = await tx<Array<{ id: string }>>`
        SELECT id FROM conversation_nodes
        WHERE conversation_id = ${conversationId}::uuid
          AND project_id      = ${projectId}::uuid
        ORDER BY created_at DESC
        LIMIT 1
      `
      return latestNode?.id ?? null
    })())

    if (!nodeId) return null

    return {
      nodeId,
      roomId: row.room_id,
      branchId: row.branch_id,
    }
  }, { userId: SYSTEM_USER_ID!, projectId })
}

/**
 * Write a structured audit log entry (Phase 3: structured console.info stub).
 * Replace with DB INSERT into audit_log table when the schema is added.
 */
async function auditLog(entry: {
  action: string
  projectId: string
  actorKind: string
  actorId: string
  meta: unknown
}): Promise<void> {
  console.info('[audit]', JSON.stringify({ ...entry, ts: new Date().toISOString() }))
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.info('[agent-runtime] starting')

  // ── Redis connections ────────────────────────────────────────────────────
  // Two connections: subscriber (dedicated, cannot issue other commands)
  // and shared (for budget guard + BullMQ internal use).
  const sharedRedis = new Redis(REDIS_URL, { maxRetriesPerRequest: null })
  const subscriberRedis = new Redis(REDIS_URL, { maxRetriesPerRequest: null })

  // ── BullMQ queues ────────────────────────────────────────────────────────
  const convEventsQueue = new Queue('conv-events', {
    connection: sharedRedis,
  })
  const agentTurnsQueue = new Queue('agent-turns', {
    connection: sharedRedis,
  })
  const dlqQueue = new Queue('agent-turns-dlq', {
    connection: sharedRedis,
  })
  const housekeepingQueue = new Queue('housekeeping', {
    connection: sharedRedis,
  })
  const delegationsQueue = new Queue('delegations', {
    connection: sharedRedis,
  })

  // ── Deps object ──────────────────────────────────────────────────────────
  const deps: TurnEngineDeps = {
    redis: sharedRedis,
    loadRosterAndRoom,
    loadRecentAncestors,
    loadWorkingMemories,
    upsertWorkingMemory,
    checkDailyUsd,
    agentTurnsQueue: agentTurnsQueue as TurnEngineDeps['agentTurnsQueue'],
    dlqQueue: dlqQueue as TurnEngineDeps['dlqQueue'],
    housekeepingQueue: housekeepingQueue as TurnEngineDeps['housekeepingQueue'],
  }

  // ── BullMQ Worker ────────────────────────────────────────────────────────
  const worker = new Worker(
    'conv-events',
    async (job) => {
      await processTurnJob(job.data as unknown, deps)
    },
    {
      connection: sharedRedis,
      concurrency: 10,
    },
  )

  // ── agent-turns Worker ───────────────────────────────────────────────────
  const agentTurnsWorker = createAgentTurnsWorker(sharedRedis, delegationsQueue)
  console.info('[agent-runtime] agent-turns worker running')

  worker.on('failed', (job, err) => {
    console.error('[agent-runtime] worker job failed', {
      jobId: job?.id,
      err: err.message,
    })
  })

  // ── Event bus bridge ─────────────────────────────────────────────────────
  // Subscribe to all projects' conv.node.appended events and bridge to BullMQ.
  const subscriber = new EventSubscriber(subscriberRedis)

  await subscriber.subscribePattern(
    'conv.node.appended:*',
    async (channel: string, payload: unknown) => {
      try {
        const p = payload as ConvNodeAppendedPayload

        // Extract nodeText from content (convention: content.text for messages)
        const content = p.node.content as { text?: string } | null
        const nodeText = typeof content?.text === 'string' ? content.text : ''

        const jobData = {
          event: 'conv.node.appended' as const,
          projectId: p.projectId,
          conversationId: p.conversationId,
          roomId: p.roomId,
          nodeId: p.node.id,
          authorKind: p.node.authorKind as 'user' | 'agent' | 'system',
          authorPersonaId: p.node.authorPersonaId ?? undefined,
          turnDepth: p.node.depth,
          nodeText,
        }

        await convEventsQueue.add('conv-event', jobData)
      } catch (err) {
        console.error('[agent-runtime] bridge error enqueueing event', {
          channel,
          err,
        })
      }
    },
  )

  console.info('[agent-runtime] subscribed to conv.node.appended:* — worker running')

  // ── Interrupt subscriber ─────────────────────────────────────────────────
  // Listen for interrupt.raise:{projectId} events from the WebSocket gateway.
  // On each event, validate and dispatch via handleInterrupt.

  // Build a dedicated subscriber Redis connection for interrupt events.
  const interruptSubscriberRedis = new Redis(REDIS_URL, { maxRetriesPerRequest: null })
  const interruptSubscriber = new EventSubscriber(interruptSubscriberRedis)
  const interruptPublisher = new EventPublisher(sharedRedis)

  const interruptDeps: InterruptDeps = {
    redis: sharedRedis,
    agentTurnsQueue: {
      add: async (name: string, data: unknown, opts?: unknown) => {
        return agentTurnsQueue.add(name, data, opts as Parameters<Queue['add']>[2])
      },
      drain: async (delayed?: boolean) => {
        await agentTurnsQueue.drain(delayed)
      },
    },
    publishEvent: async (channel: string, payload: unknown) => {
      // Use raw redis PUBLISH for channels not covered by event bus schemas
      await interruptPublisher.publish(channel, payload).catch(async () => {
        // If schema validation fails (unknown channel), publish raw
        await sharedRedis.publish(channel, JSON.stringify(payload))
      })
    },
    checkProjectMember,
    checkRoomMembership,
    archiveBranch,
    createBranch,
    getConversationHeadNode,
    auditLog,
  }

  await interruptSubscriber.subscribePattern(
    'interrupt.raise:*',
    async (_channel: string, payload: unknown) => {
      try {
        const event = payload as InterruptEvent
        await handleInterrupt(event, interruptDeps)
      } catch (err) {
        console.error('[agent-runtime] interrupt handler error', { err })
      }
    },
  )

  console.info('[agent-runtime] subscribed to interrupt.raise:* — interrupt engine running')

  // ── Graceful shutdown ────────────────────────────────────────────────────
  async function shutdown(signal: string): Promise<void> {
    console.info(`[agent-runtime] received ${signal}, shutting down gracefully`)
    subscriber.destroy()
    interruptSubscriber.destroy()
    await worker.close()
    await agentTurnsWorker.close()
    await convEventsQueue.close()
    await agentTurnsQueue.close()
    await dlqQueue.close()
    await housekeepingQueue.close()
    await delegationsQueue.close()
    await sharedRedis.quit()
    await subscriberRedis.quit()
    await interruptSubscriberRedis.quit()
    console.info('[agent-runtime] shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  process.on('SIGINT',  () => { void shutdown('SIGINT') })
}

main().catch((err: unknown) => {
  console.error('[agent-runtime] fatal startup error', err)
  process.exit(1)
})
