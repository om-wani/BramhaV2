/**
 * specialist-loop — the worker agent for background delegation tasks.
 *
 * Runs a simplified LangGraph-style loop (call_model → handle_tools → call_model)
 * for a delegated task. NEVER includes room transcript content in the context bundle:
 * only [persona system prompt, task spec, inputs, RAG(objective)].
 *
 * State machine:
 *   queued → running → completed | timeout | failed
 *
 * Budget guard:
 *   Checked before AND after each model call. Breach → status=timeout.
 *
 * On completion:
 *   INSERT delegation_report conversation node (parented to originNodeId).
 *   UPDATE delegation status → 'completed'.
 *   Enqueue LOW-priority report-back turn for the delegating C-Suite agent.
 *
 * Security:
 *   Context bundle MUST NOT contain any room transcript nodes.
 *   Only [persona system prompt, task spec, inputs, RAG] enter the model context.
 *
 * All I/O is injected via SpecialistLoopDeps for testability.
 */

import type { Redis } from 'ioredis'
import type { AgentPersona } from '@bramha/shared'
import type { ModelPolicy, CoreMessage, ToolDefinition, StreamEvent } from '@bramha/agents'
import { ModelRouter } from '@bramha/agents'
import type { RagChunk } from '../pa/context-bundle.js'
import { untrustedContext } from '../pa/context-bundle.js'
import type { DelegationJobData } from './delegation-manager.js'
import type { AgentTurnJobData } from '../orchestrator/turn-engine.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_TOOL_LOOPS = 10

// ── Specialist context (security: NO room transcript) ────────────────────────

/**
 * Context loaded for the specialist worker.
 * MUST NOT include threadNodes or any room transcript content.
 */
export interface SpecialistContext {
  persona: AgentPersona
  modelPolicy: ModelPolicy
  projectBrief: string | null
}

// ── Data shapes ───────────────────────────────────────────────────────────────

/** Partial update applied to the delegation row. */
export interface DelegationUpdate {
  status?: 'running' | 'completed' | 'failed' | 'timeout'
  result?: Record<string, unknown> | null
  startedAt?: string
  finishedAt?: string
}

/** Minimal node insert data for the specialist (widened type field). */
export interface SpecialistNodeInsertData {
  conversationId: string
  projectId: string
  /** Parent node ID — delegation_report parents to originNodeId. */
  parentId: string
  type: 'delegation_report' | 'agent_message'
  authorKind: 'agent'
  authorUserId: null
  authorPersonaId: string | null
  content: Record<string, unknown>
  tokenUsage: { inputTokens: number; outputTokens: number; estimatedUsd: number } | null
}

export interface SpecialistPersistedNode {
  id: string
  conversationId: string
  projectId: string
  parentId: string | null
  depth: number
  path: string
  type: string
  authorKind: string
  authorUserId: string | null
  authorPersonaId: string | null
  content: unknown
  tokenUsage: unknown
  createdAt: string
}

// ── Budget tracker ────────────────────────────────────────────────────────────

interface BudgetTracker {
  usdSpent: number
  toolCallsUsed: number
  startTime: number
}

interface BudgetLimits {
  maxUsd?: number
  maxSeconds?: number
  maxToolCalls?: number
}

function isBudgetExceeded(limits: BudgetLimits, tracker: BudgetTracker): boolean {
  if (limits.maxUsd !== undefined && tracker.usdSpent >= limits.maxUsd) {
    return true
  }
  if (limits.maxSeconds !== undefined) {
    const elapsedSeconds = (Date.now() - tracker.startTime) / 1000
    if (elapsedSeconds >= limits.maxSeconds) {
      return true
    }
  }
  if (limits.maxToolCalls !== undefined && tracker.toolCallsUsed >= limits.maxToolCalls) {
    return true
  }
  return false
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const searchKnowledgeSpecialistTool: ToolDefinition = {
  name: 'search_knowledge',
  description: 'Search the project knowledge base for relevant information',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
    additionalProperties: false,
  },
}

const reportProgressTool: ToolDefinition = {
  name: 'report_progress',
  description: 'Report task progress to the delegating agent',
  parameters: {
    type: 'object',
    properties: {
      pct: { type: 'number', minimum: 0, maximum: 100, description: 'Progress percentage (0–100)' },
      note: { type: 'string', description: 'Human-readable progress note' },
    },
    required: ['pct', 'note'],
    additionalProperties: false,
  },
}

const requestApprovalTool: ToolDefinition = {
  name: 'request_approval',
  description: 'Request human approval for a sensitive write action (Phase 3 stub)',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action description' },
      reason: { type: 'string', description: 'Why approval is needed' },
    },
    required: ['action', 'reason'],
    additionalProperties: false,
  },
}

const SPECIALIST_TOOLS: ToolDefinition[] = [
  searchKnowledgeSpecialistTool,
  reportProgressTool,
  requestApprovalTool,
]

// ── Dependency injection ───────────────────────────────────────────────────────

export interface SpecialistLoopDeps {
  /** Shared Redis — reserved for future interrupt checks. */
  redis: Redis

  /**
   * Load specialist persona and model policy by workerSlug + projectId.
   * The returned context MUST NOT contain room transcript data.
   */
  loadContext: (input: {
    workerSlug: string
    projectId: string
    objective: string
    inputs: Record<string, unknown>
  }) => Promise<SpecialistContext>

  /**
   * LLM streaming. Defaults to ModelRouter.chat in production.
   * Tests inject a mock AsyncGenerator.
   */
  chatModel?: (
    policy: ModelPolicy,
    messages: CoreMessage[],
    tools: ToolDefinition[],
  ) => AsyncGenerator<StreamEvent>

  /** RAG retrieval — called with objective as seed query. */
  searchKnowledge: (query: string, topK: number, projectId: string) => Promise<RagChunk[]>

  /** Persist delegation_report conversation node. */
  insertNode: (data: SpecialistNodeInsertData) => Promise<SpecialistPersistedNode>

  /** Upsert delegation fields (status, result, timestamps). */
  upsertDelegation: (delegationId: string, update: DelegationUpdate) => Promise<void>

  /** Publish on event bus. */
  publishEvent: (channel: string, payload: unknown) => Promise<void>

  /**
   * Enqueue a report-back turn for the delegating C-Suite agent.
   * Must be enqueued at low priority (10) per 04-doc §4.5.
   */
  enqueueTurn: (jobData: AgentTurnJobData, opts?: { priority?: number }) => Promise<void>
}

// ── Main loop ──────────────────────────────────────────────────────────────────

/**
 * Execute the specialist loop for one delegation job.
 *
 * This is the top-level entry point for the delegation BullMQ worker.
 * It does NOT throw — on any error, the delegation is marked failed.
 */
export async function runSpecialistLoop(
  job: DelegationJobData,
  deps: SpecialistLoopDeps,
): Promise<void> {
  const { delegationId, projectId } = job

  // ── Mark running ─────────────────────────────────────────────────────────────
  await deps.upsertDelegation(delegationId, {
    status: 'running',
    startedAt: new Date().toISOString(),
  })
  await deps.publishEvent(`delegation.started:${projectId}`, {
    delegationId,
    projectId,
  })

  try {
    // ── Load specialist context (NO room transcript) ──────────────────────────
    const ctx = await deps.loadContext({
      workerSlug: job.workerSlug,
      projectId: job.projectId,
      objective: job.objective,
      inputs: job.inputs,
    })

    // ── RAG search on objective ──────────────────────────────────────────────
    const ragChunks = await deps.searchKnowledge(job.objective, 5, projectId)

    // ── Build initial messages (SECURITY: no room transcript) ────────────────
    // Context bundle sections (04-doc §4.2):
    //   [1] Persona system prompt
    //   [2] Task spec (objective + deliverable)
    //   [3] Inputs (structured)
    //   [4] RAG block (wrapped in untrusted_context)
    //
    // ThreadNodes are intentionally absent — this is the security invariant for workers.
    const taskSpec = [
      'SPECIALIST TASK',
      '===============',
      `Objective: ${job.objective}`,
      `Deliverable: ${job.deliverable}`,
      '',
      'Inputs:',
      JSON.stringify(job.inputs, null, 2),
    ].join('\n')

    const ragSection =
      ragChunks.length > 0
        ? untrustedContext(
            ragChunks
              .map((c) => `[src:${c.chunkId}] ${c.snippet}`)
              .join('\n\n'),
          )
        : ''

    const userMessage = [taskSpec, ragSection].filter(Boolean).join('\n\n')

    let messages: CoreMessage[] = [
      { role: 'system', content: ctx.persona.systemPromptTpl },
      { role: 'user', content: userMessage },
    ]

    // ── Budget tracker ───────────────────────────────────────────────────────
    const budgetLimits: BudgetLimits = job.budget
    const tracker: BudgetTracker = {
      usdSpent: 0,
      toolCallsUsed: 0,
      startTime: Date.now(),
    }

    // ── call_model ↔ handle_tool_calls loop ──────────────────────────────────
    let finalContent = ''
    const totalUsage = { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 }

    for (let loop = 0; loop <= MAX_TOOL_LOOPS; loop++) {
      // Pre-call budget check
      if (isBudgetExceeded(budgetLimits, tracker)) {
        await handleTimeout(job, deps, finalContent)
        return
      }

      // Call model
      const stream = deps.chatModel
        ? deps.chatModel(ctx.modelPolicy, messages, SPECIALIST_TOOLS)
        : ModelRouter.chat(ctx.modelPolicy, messages, SPECIALIST_TOOLS)

      let content = ''
      const toolCalls: Array<{ callId: string; name: string; input: unknown }> = []
      const usage = { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 }

      for await (const event of stream) {
        if (event.type === 'content') {
          content += event.text
        } else if (event.type === 'tool_call') {
          toolCalls.push({ callId: event.callId, name: event.name, input: event.input })
        } else if (event.type === 'usage') {
          usage.inputTokens += event.inputTokens
          usage.outputTokens += event.outputTokens
          usage.estimatedUsd += event.estimatedUsd
        }
      }

      // Accumulate totals
      totalUsage.inputTokens += usage.inputTokens
      totalUsage.outputTokens += usage.outputTokens
      totalUsage.estimatedUsd += usage.estimatedUsd
      tracker.usdSpent += usage.estimatedUsd

      // Post-call budget check (catches USD overruns from this model call)
      if (isBudgetExceeded(budgetLimits, tracker)) {
        finalContent = content
        await handleTimeout(job, deps, finalContent)
        return
      }

      if (toolCalls.length === 0) {
        // Final answer reached
        finalContent = content
        break
      }

      if (loop >= MAX_TOOL_LOOPS) {
        finalContent = content
        console.warn('[specialist-loop] tool loop cap reached', { delegationId })
        break
      }

      // Dispatch tool calls
      const assistantTurn: CoreMessage = {
        role: 'assistant',
        content: content || '(tool call)',
      }
      messages = [...messages, assistantTurn]

      const toolResultParts: string[] = []

      for (const tc of toolCalls) {
        tracker.toolCallsUsed++

        // Post-tool-call budget check (tool calls budget)
        if (
          budgetLimits.maxToolCalls !== undefined &&
          tracker.toolCallsUsed > budgetLimits.maxToolCalls
        ) {
          await handleTimeout(job, deps, finalContent)
          return
        }

        let result: unknown
        try {
          result = await dispatchTool(tc.name, tc.input, job, deps)
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) }
        }

        toolResultParts.push(
          `Tool: ${tc.name} (id: ${tc.callId})\nResult: ${JSON.stringify(result)}`,
        )
      }

      // Wrap all tool results in untrusted_context (security invariant)
      const toolResultContent = untrustedContext(toolResultParts.join('\n\n---\n\n'))
      messages = [...messages, { role: 'user', content: toolResultContent }]
    }

    // ── Persist delegation_report node ───────────────────────────────────────
    const nodeData: SpecialistNodeInsertData = {
      conversationId: job.conversationId,
      projectId: job.projectId,
      parentId: job.originNodeId,
      type: 'delegation_report',
      authorKind: 'agent',
      authorUserId: null,
      authorPersonaId: null, // specialist worker has no room persona
      content: {
        text: finalContent,
        delegationId,
        workerSlug: job.workerSlug,
      },
      tokenUsage:
        totalUsage.inputTokens > 0 || totalUsage.outputTokens > 0 ? totalUsage : null,
    }

    const persisted = await deps.insertNode(nodeData)

    // ── Update delegation status → completed ──────────────────────────────────
    await deps.upsertDelegation(delegationId, {
      status: 'completed',
      result: {
        report_md: finalContent,
        node_id: persisted.id,
      },
      finishedAt: new Date().toISOString(),
    })

    // ── Emit delegation.completed ─────────────────────────────────────────────
    await deps.publishEvent(`delegation.completed:${projectId}`, {
      delegationId,
      projectId,
      resultNodeId: persisted.id,
      workerSlug: job.workerSlug,
    })

    // ── Enqueue LOW-priority report-back turn (04-doc §4.5) ──────────────────
    const reportBackJob: AgentTurnJobData = {
      projectId: job.projectId,
      conversationId: job.conversationId,
      branchId: job.branchId,
      triggerNodeId: persisted.id,
      personaId: job.delegatingPersonaId,
      turnDepth: 0,
      triggerReason: 'follow-up',
      otherSpeakers: [],
      forceSummon: true,
    }

    await deps.enqueueTurn(reportBackJob, { priority: 10 })
  } catch (err) {
    // ── Failed ────────────────────────────────────────────────────────────────
    console.error('[specialist-loop] unexpected error', {
      delegationId,
      error: err instanceof Error ? err.message : String(err),
    })

    await deps.upsertDelegation(delegationId, {
      status: 'failed',
      result: {
        error: err instanceof Error ? err.message : String(err),
      },
      finishedAt: new Date().toISOString(),
    }).catch(() => {
      // Best-effort — do not re-throw
    })

    await deps.publishEvent(`delegation.failed:${projectId}`, {
      delegationId,
      projectId,
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => {})
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function handleTimeout(
  job: DelegationJobData,
  deps: SpecialistLoopDeps,
  partialContent: string,
): Promise<void> {
  await deps.upsertDelegation(job.delegationId, {
    status: 'timeout',
    result: {
      partial: partialContent,
      budget_breach: true,
    },
    finishedAt: new Date().toISOString(),
  }).catch(() => {})

  await deps.publishEvent(`delegation.timeout:${job.projectId}`, {
    delegationId: job.delegationId,
    projectId: job.projectId,
  }).catch(() => {})
}

async function dispatchTool(
  name: string,
  input: unknown,
  job: DelegationJobData,
  deps: SpecialistLoopDeps,
): Promise<unknown> {
  switch (name) {
    case 'search_knowledge': {
      const { query } = input as { query: string }
      const chunks = await deps.searchKnowledge(query, 5, job.projectId)
      return {
        chunks: chunks.map((c) => ({
          id: c.chunkId,
          text: c.snippet,
          origin: c.origin,
        })),
      }
    }

    case 'report_progress': {
      const { pct, note } = input as { pct: number; note: string }
      await deps.upsertDelegation(job.delegationId, {
        result: { progress_pct: pct, progress_note: note },
      })
      await deps.publishEvent(`delegation.progress:${job.projectId}`, {
        delegationId: job.delegationId,
        projectId: job.projectId,
        progressPct: pct,
        note,
      })
      return { ok: true }
    }

    case 'request_approval': {
      // Phase 3 stub: approval flow deferred; always returns approved for now.
      // Phase 4 will create an approvals row and set delegation status=waiting_approval.
      const { action, reason } = input as { action: string; reason: string }
      console.info('[specialist-loop] request_approval stub', {
        delegationId: job.delegationId,
        action,
        reason,
      })
      return { approved: true, stub: true }
    }

    default:
      throw new Error(`Unknown specialist tool: ${name}`)
  }
}
