/**
 * AgentGraph — LangGraph-style state machine for C-Suite agent turns.
 *
 * Nodes (executed in order):
 *   build_context  → load persona, policy, working memory, RAG → assemble context bundle
 *   call_model     → stream ModelRouter → accumulate content + tool_calls
 *   handle_tool_calls → route tool calls → inject <untrusted_context> results → loop
 *   persist_node   → write conversation_node to DB + update working memory
 *   emit_events    → publish conv.node.appended + agent.turn.complete
 *
 * Edges:
 *   START → build_context → call_model
 *   call_model → handle_tool_calls  (if tool_calls present)
 *   call_model → persist_node       (if no tool_calls)
 *   handle_tool_calls → call_model  (loop)
 *   persist_node → emit_events → END
 *
 * Security:
 *   All tool results wrapped in <untrusted_context> before re-injecting into messages.
 *   Working memory updated after agent turn (extractFacts on final output).
 *   Max tool-call loop depth hard-capped at MAX_TOOL_LOOPS.
 */

import { buildContextBundle, untrustedContext } from '../pa/context-bundle.js'
import type { RagChunk, ThreadNode, ContextBundle } from '../pa/context-bundle.js'
import {
  extractFacts,
  detectOpenLoops,
  closeLoops,
  updateWorkingMemory,
} from '../pa/working-memory.js'
import type { WorkingMemory } from '../pa/working-memory.js'
import { ModelRouter } from '@bramha/agents'
import type { CoreMessage, ToolDefinition, StreamEvent } from '@bramha/agents'
import type { ModelPolicy } from '@bramha/agents'
import type { AgentPersona } from '@bramha/shared'
import type { AgentTurnJobData } from '../orchestrator/turn-engine.js'
import { Channels } from '@bramha/event-bus'

// ── Tool imports ──────────────────────────────────────────────────────────────
import { searchKnowledgeTool, executeSearchKnowledge } from './tools/search-knowledge.js'
import { createNoteTool, executeCreateNote } from './tools/create-note.js'
import { summonAgentTool, executeSummonAgent } from './tools/summon-agent.js'
import { delegateTaskTool, executeDelegateTask } from './tools/delegate-task.js'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Hard cap on tool-call loops per turn to prevent infinite agent loops. */
const MAX_TOOL_LOOPS = 10

// ── State ─────────────────────────────────────────────────────────────────────

/**
 * Immutable-style agent state threaded through each node.
 * Mirrors the LangGraph Annotation channel shape.
 */
export interface AgentState {
  messages: CoreMessage[]
  personaId: string
  projectId: string
  conversationId: string
  branchId: string
  triggerNodeId: string
  turnDepth: number
  done: boolean
}

// ── Loaded context (output of build_context node) ─────────────────────────────

export interface AgentRunContext {
  persona: AgentPersona
  modelPolicy: ModelPolicy
  projectBrief: string
  roomId: string
  workingMemory: WorkingMemory
  threadNodes: ThreadNode[]
  /** Text of the trigger node — used as RAG query seed */
  triggerText: string
  bundle: ContextBundle
  tools: ToolDefinition[]
}

// ── Persisted node shape ───────────────────────────────────────────────────────

export interface PersistedNodeData {
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

// ── Insert data shape ─────────────────────────────────────────────────────────

export interface InsertNodeData {
  conversationId: string
  projectId: string
  /** ID of the triggering node — becomes this node's parent */
  parentId: string
  type: 'agent_message'
  authorKind: 'agent'
  authorUserId: null
  authorPersonaId: string
  content: { text: string }
  tokenUsage: { inputTokens: number; outputTokens: number; estimatedUsd: number } | null
}

// ── Accumulated token usage ───────────────────────────────────────────────────

interface TokenAccum {
  inputTokens: number
  outputTokens: number
  estimatedUsd: number
}

// ── Dependency injection ───────────────────────────────────────────────────────

/**
 * All external I/O is injected via this interface so tests can mock individual
 * calls without spinning up Redis / Postgres / LLM providers.
 */
export interface AgentGraphDeps {
  /**
   * Load persona, model policy, project brief, working memory, and thread nodes
   * in a single DB round-trip (or multiple, implementation's choice).
   * Abstracts the withTenant calls; tests supply a stub.
   */
  loadContext: (args: {
    personaId: string
    projectId: string
    conversationId: string
    triggerNodeId: string
  }) => Promise<{
    persona: AgentPersona
    modelPolicy: ModelPolicy
    projectBrief: string
    roomId: string
    workingMemory: WorkingMemory
    threadNodes: ThreadNode[]
    /** Text extracted from the trigger conversation node */
    triggerText: string
  }>

  /** RAG retrieval — called from build_context node */
  searchKnowledge: (query: string, topK: number, projectId: string) => Promise<RagChunk[]>

  /**
   * LLM streaming. Defaults to ModelRouter.chat in production.
   * Tests inject a mock AsyncGenerator.
   */
  chatModel?: (
    policy: ModelPolicy,
    messages: CoreMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ) => AsyncGenerator<StreamEvent>

  /** create_note tool dependency */
  createNote: (
    title: string,
    content: string,
    tags: string[],
    projectId: string,
    personaId: string,
  ) => Promise<{ noteId: string }>

  /**
   * Persist a conversation node to DB (wraps withTenant + INSERT RETURNING *).
   * The DB trigger sets depth/path; caller only supplies logical fields.
   */
  insertNode: (data: InsertNodeData, projectId: string) => Promise<PersistedNodeData>

  /** Upsert working memory after agent turn */
  upsertWorkingMemory: (mem: WorkingMemory) => Promise<void>

  /** Publish on event bus (EventPublisher.publish equivalent) */
  publishEvent: (channel: string, payload: unknown) => Promise<void>

  /** Enqueue a delegation job (agent.turns-delegations queue or similar) */
  enqueueDelegation: (data: unknown) => Promise<{ delegationId: string }>
}

// ── Tool registry ──────────────────────────────────────────────────────────────

const ALL_CORE_TOOLS: ToolDefinition[] = [
  searchKnowledgeTool,
  createNoteTool,
  summonAgentTool,
  delegateTaskTool,
]

// ── AgentGraph ─────────────────────────────────────────────────────────────────

export class AgentGraph {
  constructor(private readonly deps: AgentGraphDeps) {}

  // ── Node: build_context ────────────────────────────────────────────────────

  private async buildContext(
    state: AgentState,
    jobData: AgentTurnJobData,
  ): Promise<AgentRunContext> {
    const loaded = await this.deps.loadContext({
      personaId: state.personaId,
      projectId: state.projectId,
      conversationId: state.conversationId,
      triggerNodeId: state.triggerNodeId,
    })

    // RAG: search with trigger text
    const ragChunks = await this.deps.searchKnowledge(
      loaded.triggerText,
      5,
      state.projectId,
    )

    // Filter tools to persona's allowlist
    const tools = ALL_CORE_TOOLS.filter((t) =>
      loaded.persona.toolAllowlist.includes(t.name),
    )

    // Assemble context bundle
    const bundle = buildContextBundle({
      systemPrompt: loaded.persona.systemPromptTpl,
      toolSchemas: tools.map((t) => JSON.stringify(t)),
      projectBrief: loaded.projectBrief,
      workingMemory: loaded.workingMemory,
      ragChunks,
      threadNodes: loaded.threadNodes,
      triggerReason: jobData.triggerReason,
      otherSpeakers: jobData.otherSpeakers,
      maxInputTokens: loaded.modelPolicy.maxInputTokens,
    })

    return {
      persona: loaded.persona,
      modelPolicy: loaded.modelPolicy,
      projectBrief: loaded.projectBrief,
      roomId: loaded.roomId,
      workingMemory: loaded.workingMemory,
      threadNodes: loaded.threadNodes,
      triggerText: loaded.triggerText,
      bundle,
      tools,
    }
  }

  // ── Node: call_model ───────────────────────────────────────────────────────

  private async callModel(
    messages: CoreMessage[],
    ctx: AgentRunContext,
    signal?: AbortSignal,
  ): Promise<{
    content: string
    toolCalls: Array<{ callId: string; name: string; input: unknown }>
    usage: TokenAccum
  }> {
    const stream = this.deps.chatModel
      ? this.deps.chatModel(ctx.modelPolicy, messages, ctx.tools, signal)
      : ModelRouter.chat(ctx.modelPolicy, messages, ctx.tools, signal)

    let content = ''
    const toolCalls: Array<{ callId: string; name: string; input: unknown }> = []
    const usage: TokenAccum = { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 }

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
      // 'thought' events are silently consumed (not persisted, not re-injected)
    }

    return { content, toolCalls, usage }
  }

  // ── Node: handle_tool_calls ────────────────────────────────────────────────

  private async handleToolCalls(
    toolCalls: Array<{ callId: string; name: string; input: unknown }>,
    assistantContent: string,
    messages: CoreMessage[],
    state: AgentState,
  ): Promise<CoreMessage[]> {
    // Append the model's assistant turn (even if content is empty, signals tool intent)
    const updatedMessages: CoreMessage[] = [
      ...messages,
      { role: 'assistant', content: assistantContent || '(tool call)' },
    ]

    const resultParts: string[] = []

    for (const tc of toolCalls) {
      let result: unknown
      try {
        result = await this.dispatchTool(tc.name, tc.input, state)
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) }
      }
      resultParts.push(
        `Tool: ${tc.name} (id: ${tc.callId})\nResult: ${JSON.stringify(result)}`,
      )
    }

    // Wrap all tool results in untrusted_context (security: never pass raw)
    const toolResultContent = untrustedContext(resultParts.join('\n\n---\n\n'))
    updatedMessages.push({ role: 'user', content: toolResultContent })

    return updatedMessages
  }

  // ── Tool dispatch ──────────────────────────────────────────────────────────

  private async dispatchTool(
    name: string,
    input: unknown,
    state: AgentState,
  ): Promise<unknown> {
    const baseDeps = {
      projectId: state.projectId,
      personaId: state.personaId,
      conversationId: state.conversationId,
    }

    switch (name) {
      case 'search_knowledge':
        return executeSearchKnowledge(input, {
          searchKnowledge: this.deps.searchKnowledge,
          projectId: state.projectId,
        })

      case 'create_note':
        return executeCreateNote(input, {
          createNote: this.deps.createNote,
          projectId: state.projectId,
          personaId: state.personaId,
        })

      case 'summon_agent':
        return executeSummonAgent(input, {
          publishEvent: this.deps.publishEvent,
          ...baseDeps,
        })

      case 'delegate_task':
        return executeDelegateTask(input, {
          enqueueDelegation: this.deps.enqueueDelegation,
          ...baseDeps,
        })

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }

  // ── Node: persist_node ─────────────────────────────────────────────────────

  private async persistNode(
    state: AgentState,
    ctx: AgentRunContext,
    finalContent: string,
    usage: TokenAccum,
  ): Promise<PersistedNodeData> {
    const nodeData: InsertNodeData = {
      conversationId: state.conversationId,
      projectId: state.projectId,
      parentId: state.triggerNodeId,
      type: 'agent_message',
      authorKind: 'agent',
      authorUserId: null,
      authorPersonaId: state.personaId,
      content: { text: finalContent },
      tokenUsage:
        usage.inputTokens > 0 || usage.outputTokens > 0
          ? usage
          : null,
    }

    const persisted = await this.deps.insertNode(nodeData, state.projectId)

    // Update working memory with facts extracted from the agent's own output
    const newFacts = extractFacts(
      finalContent,
      persisted.id,
      ctx.persona.name,
      ctx.persona.title ?? ctx.persona.slug,
    )
    const newLoops = detectOpenLoops(
      finalContent,
      persisted.id,
      ctx.persona.slug,
      'conference', // default room type; callers may override if needed
    )
    const closedIds = closeLoops(finalContent, ctx.workingMemory.openLoops)
    const updatedMem = updateWorkingMemory(
      ctx.workingMemory,
      newFacts,
      newLoops,
      closedIds,
    )
    await this.deps.upsertWorkingMemory(updatedMem)

    return persisted
  }

  // ── Node: emit_events ──────────────────────────────────────────────────────

  private async emitEvents(
    state: AgentState,
    ctx: AgentRunContext,
    persisted: PersistedNodeData,
  ): Promise<void> {
    // conv.node.appended — follows shared ConvNodeAppendedPayloadSchema
    await this.deps.publishEvent(
      Channels.convNodeAppended(state.projectId),
      {
        conversationId: state.conversationId,
        roomId: ctx.roomId,
        projectId: state.projectId,
        node: {
          id: persisted.id,
          conversationId: persisted.conversationId,
          projectId: persisted.projectId,
          parentId: persisted.parentId,
          depth: persisted.depth,
          path: persisted.path,
          type: persisted.type,
          authorKind: persisted.authorKind,
          authorUserId: persisted.authorUserId,
          authorPersonaId: persisted.authorPersonaId,
          content: persisted.content,
          tokenUsage: persisted.tokenUsage,
          createdAt: persisted.createdAt,
        },
      },
    )

    // agent.turn.complete — internal event consumed by orchestrator/UI gateway
    await this.deps.publishEvent(`agent.turn.complete:${state.projectId}`, {
      projectId: state.projectId,
      conversationId: state.conversationId,
      branchId: state.branchId,
      nodeId: persisted.id,
      personaId: state.personaId,
      turnDepth: state.turnDepth,
      ts: persisted.createdAt,
    })
  }

  // ── Main run ───────────────────────────────────────────────────────────────

  /**
   * Execute the full agent turn state machine for one BullMQ job.
   * Re-throws on stream / DB errors so BullMQ can retry.
   */
  async run(jobData: AgentTurnJobData, signal?: AbortSignal): Promise<void> {
    const state: AgentState = {
      messages: [],
      personaId: jobData.personaId,
      projectId: jobData.projectId,
      conversationId: jobData.conversationId,
      branchId: jobData.branchId,
      triggerNodeId: jobData.triggerNodeId,
      turnDepth: jobData.turnDepth,
      done: false,
    }

    // ── build_context node ───────────────────────────────────────────────────
    const ctx = await this.buildContext(state, jobData)

    // Initialise message list with assembled context bundle as system prompt
    let messages: CoreMessage[] = [
      { role: 'system', content: ctx.bundle.fullPrompt },
    ]

    // ── call_model ↔ handle_tool_calls loop ──────────────────────────────────
    let finalContent = ''
    const totalUsage: TokenAccum = { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 }

    for (let loop = 0; loop <= MAX_TOOL_LOOPS; loop++) {
      const { content, toolCalls, usage } = await this.callModel(
        messages,
        ctx,
        signal,
      )

      totalUsage.inputTokens += usage.inputTokens
      totalUsage.outputTokens += usage.outputTokens
      totalUsage.estimatedUsd += usage.estimatedUsd

      if (toolCalls.length === 0) {
        // No tool calls — final answer reached
        finalContent = content
        break
      }

      if (loop >= MAX_TOOL_LOOPS) {
        // Safety: exceeded loop cap — use whatever content we have
        finalContent = content
        console.warn('[agent-graph] tool loop cap reached', {
          conversationId: state.conversationId,
          personaId: state.personaId,
          loop,
        })
        break
      }

      // handle_tool_calls → inject results → loop back to call_model
      messages = await this.handleToolCalls(toolCalls, content, messages, state)
    }

    // ── persist_node node ────────────────────────────────────────────────────
    const persisted = await this.persistNode(state, ctx, finalContent, totalUsage)

    // ── emit_events node ─────────────────────────────────────────────────────
    state.done = true
    await this.emitEvents(state, ctx, persisted)
  }
}
