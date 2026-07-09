/**
 * AgentWorker — BullMQ Worker that consumes the `agent-turns` queue.
 *
 * Each job is processed by a fresh AgentGraph instance with the production
 * dependency set wired up (DB, Redis, queues).
 *
 * Error handling:
 *   - Stream / DB errors are re-thrown so BullMQ can retry according to job options.
 *   - The worker itself stays alive across job failures.
 *
 * Security:
 *   - All DB queries run via withTenant under SYSTEM_USER_ID (RLS project isolation).
 *   - Tool results are never passed raw to the model (enforced in AgentGraph).
 */

import { Worker, Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { withTenant } from '@bramha/db'
import type { AgentTurnJobData } from '../orchestrator/turn-engine.js'
import { AgentGraph } from './agent-graph.js'
import type { AgentGraphDeps, InsertNodeData, PersistedNodeData } from './agent-graph.js'
import type { WorkingMemory } from '../pa/working-memory.js'
import type { ThreadNode, RagChunk } from '../pa/context-bundle.js'
import type { ModelPolicy } from '@bramha/agents'
import type { AgentPersona } from '@bramha/shared'
import { EventPublisher } from '@bramha/event-bus'

// ── Production dep implementations ────────────────────────────────────────────

const SYSTEM_USER_ID = process.env['SYSTEM_USER_ID'] ?? ''

/**
 * Build the production AgentGraphDeps, wiring DB/Redis/queue I/O.
 * Called once per job; each job gets an independent deps object so there is no
 * shared mutable state between concurrent jobs.
 */
export function buildProductionDeps(
  redis: Redis,
  delegationsQueue: Queue,
): AgentGraphDeps {
  const publisher = new EventPublisher(redis)

  return {
    async loadContext({ personaId, projectId, conversationId, triggerNodeId }) {
      return withTenant(async (tx) => {
        // Load persona + model policy in one query
        const [personaRow] = await tx<
          Array<{
            id: string
            scope: string
            project_id: string | null
            tier: string
            slug: string
            name: string
            title: string | null
            avatar_key: string | null
            color: string | null
            system_prompt_tpl: string
            expertise_tags: string[]
            speak_profile: Record<string, number>
            delegation_authority: { canDelegate: string[]; perTaskBudgetUsd: number }
            tool_allowlist: string[]
            enabled: boolean
          }>
        >`
          SELECT ap.id, ap.scope, ap.project_id, ap.tier, ap.slug, ap.name, ap.title,
                 ap.avatar_key, ap.color, ap.system_prompt_tpl, ap.expertise_tags,
                 ap.speak_profile, ap.delegation_authority, ap.tool_allowlist, ap.enabled
          FROM agent_personas ap
          WHERE ap.id = ${personaId}
          LIMIT 1
        `

        const [policyRow] = await tx<
          Array<{
            tier: string
            primary_provider: string
            primary_model: string
            fallbacks: Array<{ provider: string; model: string }>
            max_input_tokens: number
            max_output_tokens: number
            temperature: number
            per_turn_usd: string
            per_day_usd: string
            prompt_caching: boolean
          }>
        >`
          SELECT tier, primary_provider, primary_model, fallbacks,
                 max_input_tokens, max_output_tokens, temperature,
                 per_turn_usd, per_day_usd, prompt_caching
          FROM agent_model_policies
          WHERE persona_id = ${personaId}
          LIMIT 1
        `

        const [projectRow] = await tx<Array<{ brief: string | null }>>`
          SELECT settings->>'brief' AS brief
          FROM projects
          WHERE id = ${projectId}
          LIMIT 1
        `

        const [convRow] = await tx<Array<{ room_id: string }>>`
          SELECT room_id FROM conversations WHERE id = ${conversationId} AND project_id = ${projectId}
          LIMIT 1
        `

        const [memRow] = await tx<
          Array<{
            facts: WorkingMemory['facts']
            open_loops: WorkingMemory['openLoops']
            last_summary_node: string | null
            summary_md: string | null
            updated_at: string
          }>
        >`
          SELECT facts, open_loops, last_summary_node, summary_md, updated_at::text AS updated_at
          FROM agent_working_memory
          WHERE persona_id = ${personaId}
            AND conversation_id = ${conversationId}
            AND project_id = ${projectId}
          LIMIT 1
        `

        // Load thread nodes (last 20, oldest-first)
        const threadRows = await tx<
          Array<{
            id: string
            author_kind: string
            author_persona_id: string | null
            content: { text?: string } | null
            type: string
          }>
        >`
          SELECT id, author_kind, author_persona_id, content, type
          FROM conversation_nodes
          WHERE conversation_id = ${conversationId}
            AND project_id = ${projectId}
          ORDER BY created_at ASC
          LIMIT 20
        `

        // Load trigger node text
        const [triggerRow] = await tx<Array<{ content: { text?: string } | null }>>`
          SELECT content FROM conversation_nodes
          WHERE id = ${triggerNodeId} AND project_id = ${projectId}
          LIMIT 1
        `

        const persona: AgentPersona = {
          id: personaRow!.id,
          scope: personaRow!.scope as 'global' | 'project',
          projectId: personaRow!.project_id,
          tier: personaRow!.tier as 'csuite' | 'specialist' | 'pa',
          slug: personaRow!.slug,
          name: personaRow!.name,
          title: personaRow!.title,
          avatarKey: personaRow!.avatar_key,
          color: personaRow!.color,
          systemPromptTpl: personaRow!.system_prompt_tpl,
          expertiseTags: personaRow!.expertise_tags,
          speakProfile: {
            eagerness: (personaRow!.speak_profile['eagerness'] as number) ?? 0,
            interruptThreshold: (personaRow!.speak_profile['interruptThreshold'] as number) ?? 1.4,
            silenceBias: (personaRow!.speak_profile['silenceBias'] as number) ?? 0,
          },
          delegationAuthority: {
            canDelegate: personaRow!.delegation_authority.canDelegate,
            perTaskBudgetUsd: personaRow!.delegation_authority.perTaskBudgetUsd,
          },
          toolAllowlist: personaRow!.tool_allowlist,
          enabled: personaRow!.enabled,
        }

        const modelPolicy: ModelPolicy = {
          tier: policyRow!.tier as 'csuite' | 'specialist' | 'utility',
          primary: { provider: policyRow!.primary_provider, model: policyRow!.primary_model },
          fallbacks: policyRow!.fallbacks,
          maxInputTokens: policyRow!.max_input_tokens,
          maxOutputTokens: policyRow!.max_output_tokens,
          temperature: policyRow!.temperature,
          budget: {
            perTurnUSD: parseFloat(policyRow!.per_turn_usd),
            perDayUSD: parseFloat(policyRow!.per_day_usd),
          },
          cache: {
            promptCaching: policyRow!.prompt_caching,
            semanticCacheTTLs: 0,
          },
        }

        const workingMemory: WorkingMemory = memRow
          ? {
              personaId,
              conversationId,
              projectId,
              facts: (memRow.facts as WorkingMemory['facts']) ?? [],
              openLoops: (memRow.open_loops as WorkingMemory['openLoops']) ?? [],
              lastSummaryNode: memRow.last_summary_node,
              summaryMd: memRow.summary_md,
              updatedAt: memRow.updated_at,
            }
          : {
              personaId,
              conversationId,
              projectId,
              facts: [],
              openLoops: [],
              lastSummaryNode: null,
              summaryMd: null,
              updatedAt: new Date().toISOString(),
            }

        const threadNodes: ThreadNode[] = threadRows.map((r) => ({
          nodeId: r.id,
          authorKind: r.author_kind as ThreadNode['authorKind'],
          authorName: r.author_persona_id ?? 'user',
          text: r.content?.text ?? '',
          type: r.type,
        }))

        const triggerText = triggerRow?.content?.text ?? ''

        return {
          persona,
          modelPolicy,
          projectBrief: projectRow?.brief ?? '',
          roomId: convRow?.room_id ?? '',
          workingMemory,
          threadNodes,
          triggerText,
        }
      }, { userId: SYSTEM_USER_ID, projectId })
    },

    async searchKnowledge(): Promise<RagChunk[]> {
      // Phase 3 stub: vector search not yet wired; returns empty.
      // Replace with actual embedding search in Phase 4 (T2.3.4).
      return []
    },

    async createNote(title, content, tags, projectId, personaId) {
      return withTenant(async (tx) => {
        const [row] = await tx<Array<{ id: string }>>`
          INSERT INTO notes (project_id, created_by_persona_id, title, content, tags)
          VALUES (${projectId}, ${personaId}, ${title}, ${content}, ${tags})
          RETURNING id
        `
        return { noteId: row!.id }
      }, { userId: SYSTEM_USER_ID, projectId })
    },

    async insertNode(data: InsertNodeData, projectId: string): Promise<PersistedNodeData> {
      return withTenant(async (tx) => {
        const [row] = await tx<
          Array<{
            id: string
            conversation_id: string
            project_id: string
            parent_id: string | null
            depth: number
            path: string
            type: string
            author_kind: string
            author_user_id: string | null
            author_persona_id: string | null
            content: unknown
            token_usage: unknown
            created_at: string
          }>
        >`
          INSERT INTO conversation_nodes
            (conversation_id, project_id, parent_id, type, author_kind,
             author_user_id, author_persona_id, content, token_usage)
          VALUES (
            ${data.conversationId},
            ${data.projectId},
            ${data.parentId},
            ${data.type},
            ${data.authorKind},
            ${data.authorUserId},
            ${data.authorPersonaId},
            ${JSON.stringify(data.content)},
            ${data.tokenUsage ? JSON.stringify(data.tokenUsage) : null}
          )
          RETURNING
            id,
            conversation_id,
            project_id,
            parent_id,
            depth,
            path::text AS path,
            type,
            author_kind,
            author_user_id,
            author_persona_id,
            content,
            token_usage,
            created_at::text AS created_at
        `
        return {
          id: row!.id,
          conversationId: row!.conversation_id,
          projectId: row!.project_id,
          parentId: row!.parent_id,
          depth: row!.depth,
          path: row!.path,
          type: row!.type,
          authorKind: row!.author_kind,
          authorUserId: row!.author_user_id,
          authorPersonaId: row!.author_persona_id,
          content: row!.content,
          tokenUsage: row!.token_usage,
          createdAt: row!.created_at,
        }
      }, { userId: SYSTEM_USER_ID, projectId })
    },

    async upsertWorkingMemory(mem: WorkingMemory): Promise<void> {
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
      }, { userId: SYSTEM_USER_ID, projectId: mem.projectId })
    },

    async publishEvent(channel: string, payload: unknown): Promise<void> {
      await publisher.publish(channel, payload)
    },

    async enqueueDelegation(data: unknown): Promise<{ delegationId: string }> {
      await delegationsQueue.add('delegation', data)
      const d = data as { delegationId: string }
      return { delegationId: d.delegationId }
    },
  }
}

// ── Worker factory ─────────────────────────────────────────────────────────────

/**
 * Create and start the `agent-turns` BullMQ Worker.
 * Returns the Worker so the caller can wire shutdown logic.
 */
export function createAgentTurnsWorker(
  redis: Redis,
  delegationsQueue: Queue,
  concurrency = 5,
): Worker {
  const worker = new Worker<AgentTurnJobData>(
    'agent-turns',
    async (job) => {
      const deps = buildProductionDeps(redis, delegationsQueue)
      const graph = new AgentGraph(deps)
      // Re-throw so BullMQ records the failure and retries per job options.
      await graph.run(job.data)
    },
    {
      connection: redis,
      concurrency,
    },
  )

  worker.on('failed', (job, err) => {
    console.error('[agent-turns-worker] job failed', {
      jobId: job?.id,
      personaId: (job?.data as AgentTurnJobData | undefined)?.personaId,
      err: err.message,
    })
  })

  return worker
}
