/**
 * DelegationWorker — BullMQ Worker consuming the 'delegations' queue.
 *
 * Each job is processed by runSpecialistLoop with a production dependency set
 * wired up to DB, Redis, BullMQ queues, and the event publisher.
 *
 * Error handling:
 *   - runSpecialistLoop does NOT re-throw; it catches errors and marks the
 *     delegation as 'failed'. BullMQ will not retry unless re-throw occurs.
 *
 * Security:
 *   - All DB queries run via withTenant under SYSTEM_USER_ID (RLS project isolation).
 *   - loadContext intentionally omits room transcript from the context bundle.
 */

import { Worker, Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { withTenant } from '@bramha/db'
import { EventPublisher } from '@bramha/event-bus'
import type { AgentPersona } from '@bramha/shared'
import type { ModelPolicy } from '@bramha/agents'
import type { DelegationJobData } from './delegation-manager.js'
import { runSpecialistLoop } from './specialist-loop.js'
import type {
  SpecialistLoopDeps,
  SpecialistContext,
  SpecialistNodeInsertData,
  SpecialistPersistedNode,
  DelegationUpdate,
} from './specialist-loop.js'
import type { AgentTurnJobData } from '../orchestrator/turn-engine.js'
import type { RagChunk } from '../pa/context-bundle.js'

// ── Environment ───────────────────────────────────────────────────────────────

const SYSTEM_USER_ID = process.env['SYSTEM_USER_ID']
if (!SYSTEM_USER_ID) throw new Error('SYSTEM_USER_ID environment variable is required')

// ── Production dep builder ────────────────────────────────────────────────────

/**
 * Build the production SpecialistLoopDeps for one delegation job.
 * Called once per job; each job gets independent deps — no shared mutable state.
 */
export function buildDelegationProductionDeps(
  redis: Redis,
  agentTurnsQueue: Queue,
): SpecialistLoopDeps {
  const publisher = new EventPublisher(redis)

  return {
    redis,

    async loadContext({ workerSlug, projectId }): Promise<SpecialistContext> {
      return withTenant(
        async (tx) => {
          // Load specialist persona by slug (+ project scope or global)
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
            SELECT id, scope, project_id, tier, slug, name, title, avatar_key, color,
                   system_prompt_tpl, expertise_tags, speak_profile, delegation_authority,
                   tool_allowlist, enabled
            FROM agent_personas
            WHERE slug = ${workerSlug}
              AND enabled = TRUE
              AND (scope = 'global' OR project_id = ${projectId}::uuid)
            ORDER BY scope DESC  -- prefer project-scoped over global
            LIMIT 1
          `

          if (!personaRow) {
            throw new Error(`Specialist persona not found for slug '${workerSlug}'`)
          }

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
            WHERE persona_id = ${personaRow.id}::uuid
            LIMIT 1
          `

          const [projectRow] = await tx<Array<{ brief: string | null }>>`
            SELECT settings->>'brief' AS brief
            FROM projects
            WHERE id = ${projectId}::uuid
            LIMIT 1
          `

          const persona: AgentPersona = {
            id: personaRow.id,
            scope: personaRow.scope as 'global' | 'project',
            projectId: personaRow.project_id,
            tier: personaRow.tier as 'csuite' | 'specialist' | 'pa',
            slug: personaRow.slug,
            name: personaRow.name,
            title: personaRow.title,
            avatarKey: personaRow.avatar_key,
            color: personaRow.color,
            systemPromptTpl: personaRow.system_prompt_tpl,
            expertiseTags: personaRow.expertise_tags,
            speakProfile: {
              eagerness: (personaRow.speak_profile['eagerness'] as number) ?? 0,
              interruptThreshold:
                (personaRow.speak_profile['interruptThreshold'] as number) ?? 1.4,
              silenceBias: (personaRow.speak_profile['silenceBias'] as number) ?? 0,
            },
            delegationAuthority: {
              canDelegate: personaRow.delegation_authority.canDelegate,
              perTaskBudgetUsd: personaRow.delegation_authority.perTaskBudgetUsd,
            },
            toolAllowlist: personaRow.tool_allowlist,
            enabled: personaRow.enabled,
          }

          const modelPolicy: ModelPolicy = policyRow
            ? {
                tier: policyRow.tier as 'csuite' | 'specialist' | 'utility',
                primary: {
                  provider: policyRow.primary_provider,
                  model: policyRow.primary_model,
                },
                fallbacks: policyRow.fallbacks,
                maxInputTokens: policyRow.max_input_tokens,
                maxOutputTokens: policyRow.max_output_tokens,
                temperature: policyRow.temperature,
                budget: {
                  perTurnUSD: parseFloat(policyRow.per_turn_usd),
                  perDayUSD: parseFloat(policyRow.per_day_usd),
                },
                cache: {
                  promptCaching: policyRow.prompt_caching,
                  semanticCacheTTLs: 0,
                },
              }
            : {
                // Default specialist policy when not configured
                tier: 'specialist',
                primary: { provider: 'anthropic', model: 'claude-haiku-4-5' },
                fallbacks: [],
                maxInputTokens: 8192,
                maxOutputTokens: 2048,
                temperature: 0.3,
                budget: { perTurnUSD: 0.1, perDayUSD: 5 },
                cache: { promptCaching: false, semanticCacheTTLs: 0 },
              }

          return {
            persona,
            modelPolicy,
            projectBrief: projectRow?.brief ?? null,
          }
        },
        { userId: SYSTEM_USER_ID!, projectId },
      )
    },

    async searchKnowledge(): Promise<RagChunk[]> {
      // Phase 3 stub: vector search not yet wired; returns empty.
      // Replace with actual hybrid search in Phase 4 (T2.3.4).
      return []
    },

    async insertNode(data: SpecialistNodeInsertData): Promise<SpecialistPersistedNode> {
      return withTenant(
        async (tx) => {
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
              ${data.conversationId}::uuid,
              ${data.projectId}::uuid,
              ${data.parentId}::uuid,
              ${data.type},
              ${data.authorKind},
              ${data.authorUserId},
              ${data.authorPersonaId},
              ${JSON.stringify(data.content)}::jsonb,
              ${data.tokenUsage ? JSON.stringify(data.tokenUsage) : null}::jsonb
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
        },
        { userId: SYSTEM_USER_ID!, projectId: data.projectId },
      )
    },

    async upsertDelegation(
      delegationId: string,
      update: DelegationUpdate,
    ): Promise<void> {
      // Build UPDATE SET clauses dynamically based on what's provided
      // We need a project context for RLS; use a sub-select to get it.
      await withTenant(
        async (tx) => {
          // Fetch project_id for RLS context (needed for SET LOCAL in the same tx)
          const [d] = await tx<Array<{ project_id: string }>>`
            SELECT project_id FROM delegations WHERE id = ${delegationId}::uuid LIMIT 1
          `
          if (!d) return

          // Update the delegation row
          if (update.status !== undefined) {
            await tx`
              UPDATE delegations
              SET status = ${update.status},
                  ${update.startedAt ? tx`started_at = ${update.startedAt}::timestamptz,` : tx``}
                  ${update.finishedAt ? tx`finished_at = ${update.finishedAt}::timestamptz,` : tx``}
                  result = COALESCE(result, '{}'::jsonb) || ${JSON.stringify(update.result ?? {})}::jsonb
              WHERE id = ${delegationId}::uuid
            `
          } else if (update.result !== undefined) {
            // Progress update — merge result without changing status
            await tx`
              UPDATE delegations
              SET result = COALESCE(result, '{}'::jsonb) || ${JSON.stringify(update.result)}::jsonb
              WHERE id = ${delegationId}::uuid
            `
          }
        },
        { userId: SYSTEM_USER_ID!, projectId: null },
      )
    },

    async publishEvent(channel: string, payload: unknown): Promise<void> {
      // Use raw redis publish for delegation-specific channels (no schema validation needed)
      await (publisher.publish(channel, payload).catch(async () => {
        await redis.publish(channel, JSON.stringify(payload))
      }))
    },

    async enqueueTurn(jobData: AgentTurnJobData, opts?: { priority?: number }): Promise<void> {
      await agentTurnsQueue.add('agent-turn', jobData, {
        ...(opts?.priority !== undefined ? { priority: opts.priority } : {}),
      })
    },
  }
}

// ── Worker factory ─────────────────────────────────────────────────────────────

/**
 * Create and start the `delegations` BullMQ Worker.
 * Returns the Worker so the caller can wire shutdown logic.
 */
export function createDelegationWorker(
  redis: Redis,
  agentTurnsQueue: Queue,
  concurrency = 3,
): Worker {
  const worker = new Worker<DelegationJobData>(
    'delegations',
    async (job) => {
      const deps = buildDelegationProductionDeps(redis, agentTurnsQueue)
      await runSpecialistLoop(job.data, deps)
      // runSpecialistLoop handles errors internally; do not re-throw here
      // unless we want BullMQ to retry the job.
    },
    {
      connection: redis,
      concurrency,
    },
  )

  worker.on('failed', (job, err) => {
    console.error('[delegation-worker] job failed', {
      jobId: job?.id,
      delegationId: (job?.data as DelegationJobData | undefined)?.delegationId,
      err: err.message,
    })
  })

  return worker
}
