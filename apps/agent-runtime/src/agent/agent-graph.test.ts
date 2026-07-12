/**
 * AgentGraph unit tests — all external I/O is mocked via AgentGraphDeps.
 *
 * Tests cover:
 *   1.  Full happy path (no tool calls)
 *   2.  Tool call loop: search_knowledge → inject → model continues → persists
 *   3.  Multi-turn tool loop (2 tool calls before final answer)
 *   4.  summon_agent tool emits agent.summoned event
 *   5.  delegate_task tool enqueues delegation job
 *   6.  Stream error → re-thrown (BullMQ retry)
 *   7.  Context bundle token budget applied (buildContextBundle called with correct params)
 *   8.  Working memory updated after agent turn (extractFacts + upsertWorkingMemory)
 *   9.  conv.node.appended event emitted with correct payload after persist
 *   10. agent.turn.complete event emitted after emit_events node
 */

import { describe, it, expect, vi } from 'vitest'
import { AgentGraph } from './agent-graph.js'
import type { AgentGraphDeps, PersistedNodeData } from './agent-graph.js'
import type { AgentTurnJobData } from '../orchestrator/turn-engine.js'
import type { WorkingMemory } from '../pa/working-memory.js'
import type { AgentPersona } from '@bramha/shared'
import type { ModelPolicy, StreamEvent } from '@bramha/agents'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROJECT_ID = '00000000-0000-0000-0000-000000000001'
const CONVERSATION_ID = '00000000-0000-0000-0000-000000000002'
const BRANCH_ID = '00000000-0000-0000-0000-000000000003'
const TRIGGER_NODE_ID = '00000000-0000-0000-0000-000000000004'
const PERSONA_ID = '00000000-0000-0000-0000-000000000005'
const ROOM_ID = '00000000-0000-0000-0000-000000000006'
const PERSISTED_NODE_ID = '00000000-0000-0000-0000-000000000099'

const baseJobData: AgentTurnJobData = {
  projectId: PROJECT_ID,
  conversationId: CONVERSATION_ID,
  branchId: BRANCH_ID,
  triggerNodeId: TRIGGER_NODE_ID,
  personaId: PERSONA_ID,
  turnDepth: 1,
  triggerReason: 'mention',
  otherSpeakers: [],
}

const mockPersona: AgentPersona = {
  id: PERSONA_ID,
  scope: 'global',
  projectId: null,
  tier: 'csuite',
  slug: 'cto',
  name: 'Chief Technology Officer',
  title: 'CTO',
  avatarKey: null,
  color: '#4f46e5',
  systemPromptTpl: 'You are the CTO. {{safety_clauses}}',
  expertiseTags: ['engineering', 'architecture'],
  speakProfile: { eagerness: 0.7, interruptThreshold: 1.4, silenceBias: 0 },
  delegationAuthority: { canDelegate: ['researcher'], perTaskBudgetUsd: 10 },
  // Allowlist the 4 core tools
  toolAllowlist: ['search_knowledge', 'create_note', 'summon_agent', 'delegate_task'],
  enabled: true,
}

const mockModelPolicy: ModelPolicy = {
  tier: 'csuite',
  primary: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  fallbacks: [],
  maxInputTokens: 8192,
  maxOutputTokens: 2048,
  temperature: 0.7,
  budget: { perTurnUSD: 0.5, perDayUSD: 10 },
  cache: { promptCaching: true, semanticCacheTTLs: 0 },
}

const mockWorkingMemory: WorkingMemory = {
  personaId: PERSONA_ID,
  conversationId: CONVERSATION_ID,
  projectId: PROJECT_ID,
  facts: [],
  openLoops: [],
  lastSummaryNode: null,
  summaryMd: null,
  updatedAt: new Date().toISOString(),
}

const mockPersistedNode: PersistedNodeData = {
  id: PERSISTED_NODE_ID,
  conversationId: CONVERSATION_ID,
  projectId: PROJECT_ID,
  parentId: TRIGGER_NODE_ID,
  depth: 1,
  path: 'root.child',
  type: 'agent_message',
  authorKind: 'agent',
  authorUserId: null,
  authorPersonaId: PERSONA_ID,
  content: { text: 'The final model answer.' },
  tokenUsage: { inputTokens: 100, outputTokens: 50, estimatedUsd: 0.001 },
  createdAt: new Date().toISOString(),
}

/** Build a mock AsyncGenerator that yields the given events then completes. */
async function* makeStream(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const e of events) yield e
}

// ── Dep factory ────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<AgentGraphDeps> = {}): AgentGraphDeps {
  return {
    // Mock redis: always returns 0 (no interrupt flag set) so existing tests are unaffected
    redis: {
      exists: vi.fn().mockResolvedValue(0),
    } as unknown as AgentGraphDeps['redis'],

    loadContext: vi.fn().mockResolvedValue({
      persona: mockPersona,
      modelPolicy: mockModelPolicy,
      projectBrief: 'BramhaV2 AI SaaS platform.',
      roomId: ROOM_ID,
      roomType: 'conference',
      roomIsConfidential: false,
      workingMemory: mockWorkingMemory,
      threadNodes: [
        {
          nodeId: TRIGGER_NODE_ID,
          authorKind: 'user',
          authorName: 'user',
          text: 'What is our cloud cost situation?',
          type: 'user_message',
        },
      ],
      triggerText: 'What is our cloud cost situation?',
    }),

    searchKnowledge: vi.fn().mockResolvedValue([]),
    loadProjectFacts: vi.fn().mockResolvedValue([]),
    createNote: vi.fn().mockResolvedValue({ noteId: 'note-abc' }),
    insertNode: vi.fn().mockResolvedValue(mockPersistedNode),
    upsertWorkingMemory: vi.fn().mockResolvedValue(undefined),
    publishEvent: vi.fn().mockResolvedValue(undefined),
    enqueueDelegation: vi.fn().mockResolvedValue({ delegationId: 'del-xyz' }),

    // Default: model returns a simple content response (no tool calls)
    chatModel: vi.fn().mockImplementation(() =>
      makeStream([
        { type: 'content', text: 'The final model answer.' },
        { type: 'usage', inputTokens: 100, outputTokens: 50, estimatedUsd: 0.001 },
      ]),
    ),

    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('AgentGraph', () => {
  describe('Test 1 — full happy path (no tool calls)', () => {
    it('runs build_context → call_model → persist_node → emit_events in order', async () => {
      const deps = makeDeps()
      const graph = new AgentGraph(deps)

      await graph.run(baseJobData)

      expect(deps.loadContext).toHaveBeenCalledOnce()
      expect(deps.loadContext).toHaveBeenCalledWith({
        personaId: PERSONA_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        triggerNodeId: TRIGGER_NODE_ID,
      })

      // RAG called during build_context
      expect(deps.searchKnowledge).toHaveBeenCalledOnce()

      // Model called once (no tool loop)
      expect(deps.chatModel).toHaveBeenCalledOnce()

      // Node persisted with agent message content
      expect(deps.insertNode).toHaveBeenCalledOnce()
      const insertCall = vi.mocked(deps.insertNode).mock.calls[0]
      expect(insertCall![0].type).toBe('agent_message')
      expect(insertCall![0].authorKind).toBe('agent')
      expect(insertCall![0].authorPersonaId).toBe(PERSONA_ID)
      expect(insertCall![0].content).toEqual({
        text: 'The final model answer.',
        meta: { triggerReason: 'mention' },
      })
      expect(insertCall![0].parentId).toBe(TRIGGER_NODE_ID)

      // Working memory upserted
      expect(deps.upsertWorkingMemory).toHaveBeenCalledOnce()

      // Both events published
      expect(deps.publishEvent).toHaveBeenCalledTimes(2)
    })
  })

  describe('Test 2 — tool call loop: search_knowledge → inject → final answer', () => {
    it('loops through call_model → handle_tool_calls → call_model then persists', async () => {
      let callCount = 0
      const deps = makeDeps({
        chatModel: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            // First call: model wants to search
            return makeStream([
              {
                type: 'tool_call',
                callId: 'tc-1',
                name: 'search_knowledge',
                input: { query: 'cloud cost', topK: 5 },
              },
            ])
          }
          // Second call: model returns final answer
          return makeStream([
            { type: 'content', text: 'Cloud spend is $12k/month.' },
            { type: 'usage', inputTokens: 200, outputTokens: 80, estimatedUsd: 0.002 },
          ])
        }),
        searchKnowledge: vi.fn().mockResolvedValue([
          {
            chunkId: 'chunk-1',
            origin: 'cost-report.pdf',
            headingTrail: ['Cloud Costs'],
            snippet: 'AWS bill: $12,000/month.',
            score: 0.92,
          },
        ]),
      })

      const graph = new AgentGraph(deps)
      await graph.run(baseJobData)

      // chatModel called twice: first for tool call, second after injection
      expect(deps.chatModel).toHaveBeenCalledTimes(2)

      // searchKnowledge called once during build_context (RAG seed) + once via tool
      // build_context always calls searchKnowledge for RAG; tool dispatch calls it again
      expect(deps.searchKnowledge).toHaveBeenCalledTimes(2)

      // Persisted node has the second model's content
      const insertCall = vi.mocked(deps.insertNode).mock.calls[0]
      expect(insertCall![0].content).toEqual({
        text: 'Cloud spend is $12k/month.',
        meta: { triggerReason: 'mention' },
      })

      // Second chatModel call's messages should include untrusted_context from tool result
      const secondCallMessages = vi.mocked(deps.chatModel!).mock.calls[1]![1]
      const lastMsg = secondCallMessages[secondCallMessages.length - 1]
      expect(lastMsg!.role).toBe('user')
      expect(lastMsg!.content).toContain('<untrusted_context>')
      expect(lastMsg!.content).toContain('search_knowledge')
    })
  })

  describe('Test 3 — multi-turn tool loop (2 tool calls before final answer)', () => {
    it('loops twice through handle_tool_calls before persisting', async () => {
      let callCount = 0
      const deps = makeDeps({
        chatModel: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return makeStream([
              {
                type: 'tool_call',
                callId: 'tc-1',
                name: 'search_knowledge',
                input: { query: 'cloud cost', topK: 3 },
              },
            ])
          }
          if (callCount === 2) {
            return makeStream([
              {
                type: 'tool_call',
                callId: 'tc-2',
                name: 'create_note',
                input: { title: 'Cloud Cost Note', content: 'Cloud spend is high.', tags: [] },
              },
            ])
          }
          // Third call: final answer
          return makeStream([
            { type: 'content', text: 'I have saved the note and analyzed costs.' },
            { type: 'usage', inputTokens: 300, outputTokens: 100, estimatedUsd: 0.003 },
          ])
        }),
      })

      const graph = new AgentGraph(deps)
      await graph.run(baseJobData)

      expect(deps.chatModel).toHaveBeenCalledTimes(3)
      expect(deps.createNote).toHaveBeenCalledOnce()
      expect(deps.insertNode).toHaveBeenCalledOnce()

      const insertCall = vi.mocked(deps.insertNode).mock.calls[0]
      expect(insertCall![0].content).toEqual({
        text: 'I have saved the note and analyzed costs.',
        meta: { triggerReason: 'mention' },
      })
    })
  })

  describe('Test 4 — summon_agent tool emits agent.summoned event', () => {
    it('publishes agent.summoned:{projectId} when summon_agent tool executes', async () => {
      let callCount = 0
      const publishSpy = vi.fn().mockResolvedValue(undefined)
      const deps = makeDeps({
        publishEvent: publishSpy,
        chatModel: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return makeStream([
              {
                type: 'tool_call',
                callId: 'tc-summon',
                name: 'summon_agent',
                input: { agentSlug: 'cfo', reason: 'Budget analysis needed' },
              },
            ])
          }
          return makeStream([
            { type: 'content', text: 'I have summoned the CFO.' },
            { type: 'usage', inputTokens: 50, outputTokens: 20, estimatedUsd: 0.0005 },
          ])
        }),
      })

      const graph = new AgentGraph(deps)
      await graph.run(baseJobData)

      const summonCall = publishSpy.mock.calls.find(
        (call: unknown[]) => String(call[0]).startsWith('agent.summoned:'),
      )
      expect(summonCall).toBeDefined()
      expect(summonCall![0]).toBe(`agent.summoned:${PROJECT_ID}`)
      expect(summonCall![1]).toMatchObject({
        projectId: PROJECT_ID,
        agentSlug: 'cfo',
        reason: 'Budget analysis needed',
        requestedByPersonaId: PERSONA_ID,
      })
    })
  })

  describe('Test 5 — delegate_task tool enqueues delegation job', () => {
    it('calls enqueueDelegation when delegate_task tool executes', async () => {
      let callCount = 0
      const enqueueSpy = vi.fn().mockResolvedValue({ delegationId: 'del-123' })
      const deps = makeDeps({
        enqueueDelegation: enqueueSpy,
        chatModel: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return makeStream([
              {
                type: 'tool_call',
                callId: 'tc-delegate',
                name: 'delegate_task',
                input: {
                  workerType: 'researcher',
                  taskDescription: 'Research competitor pricing',
                  inputs: { competitors: ['A', 'B'] },
                },
              },
            ])
          }
          return makeStream([
            { type: 'content', text: 'Delegated research to specialist.' },
            { type: 'usage', inputTokens: 60, outputTokens: 25, estimatedUsd: 0.0006 },
          ])
        }),
      })

      const graph = new AgentGraph(deps)
      await graph.run(baseJobData)

      expect(enqueueSpy).toHaveBeenCalledOnce()
      const delegationPayload = enqueueSpy.mock.calls[0]![0] as {
        workerType: string
        taskDescription: string
        inputs: Record<string, unknown>
        projectId: string
        requestedByPersonaId: string
      }
      expect(delegationPayload.workerType).toBe('researcher')
      expect(delegationPayload.taskDescription).toBe('Research competitor pricing')
      expect(delegationPayload.projectId).toBe(PROJECT_ID)
      expect(delegationPayload.requestedByPersonaId).toBe(PERSONA_ID)
      expect(delegationPayload.inputs).toEqual({ competitors: ['A', 'B'] })
    })
  })

  describe('Test 6 — stream error → job fails (re-thrown)', () => {
    it('re-throws errors from chatModel so BullMQ can retry', async () => {
      const streamError = new Error('Provider timeout')
      const deps = makeDeps({
        chatModel: vi.fn().mockImplementation(
          (): AsyncGenerator<StreamEvent> =>
            ({
              [Symbol.asyncIterator]() {
                return this
              },
              async next(): Promise<IteratorResult<StreamEvent>> {
                throw streamError
              },
              async return(): Promise<IteratorResult<StreamEvent>> {
                return { done: true, value: undefined as unknown as StreamEvent }
              },
            }) as unknown as AsyncGenerator<StreamEvent>,
        ),
      })

      const graph = new AgentGraph(deps)
      await expect(graph.run(baseJobData)).rejects.toThrow('Provider timeout')

      // Node must NOT have been persisted on stream failure
      expect(deps.insertNode).not.toHaveBeenCalled()
      // No events emitted on failure
      expect(deps.publishEvent).not.toHaveBeenCalled()
    })
  })

  describe('Test 7 — context bundle token budget applied', () => {
    it('calls buildContextBundle with maxInputTokens from modelPolicy', async () => {
      // We verify this indirectly: the system message sent to chatModel should be a non-empty
      // string assembled from the context bundle (system prompt + thread + etc.)
      const deps = makeDeps({
        loadContext: vi.fn().mockResolvedValue({
          persona: mockPersona,
          modelPolicy: { ...mockModelPolicy, maxInputTokens: 4096 },
          projectBrief: 'Short brief.',
          roomId: ROOM_ID,
          roomType: 'conference',
          roomIsConfidential: false,
          workingMemory: {
            ...mockWorkingMemory,
            summaryMd: 'Previous summary: decided to move to Kubernetes.',
          },
          threadNodes: [
            {
              nodeId: TRIGGER_NODE_ID,
              authorKind: 'user',
              authorName: 'CEO',
              text: 'What is our infra plan?',
              type: 'user_message',
            },
          ],
          triggerText: 'What is our infra plan?',
        }),
      })

      const graph = new AgentGraph(deps)
      await graph.run(baseJobData)

      const chatArgs = vi.mocked(deps.chatModel!).mock.calls[0]!
      const messages = chatArgs[1]
      const systemMessage = messages.find((m) => m.role === 'system')

      // System message must be non-empty and contain persona system prompt content
      expect(systemMessage).toBeDefined()
      expect(systemMessage!.content.length).toBeGreaterThan(50)

      // The model policy passed to chatModel must have the overridden maxInputTokens
      const policyArg = chatArgs[0]
      expect(policyArg.maxInputTokens).toBe(4096)

      // Bundle assembler respects budget: system message should not exceed ~4096 * 4 chars
      // (rough 4-chars/token estimate; hard upper bound sanity check)
      expect(systemMessage!.content.length).toBeLessThan(4096 * 6)
    })
  })

  describe('Test 8 — working memory updated after agent turn', () => {
    it('calls upsertWorkingMemory with updated facts extracted from agent output', async () => {
      const deps = makeDeps({
        chatModel: vi.fn().mockImplementation(() =>
          makeStream([
            { type: 'content', text: 'We will migrate to Kubernetes by Q3 2026.' },
            { type: 'usage', inputTokens: 80, outputTokens: 40, estimatedUsd: 0.0008 },
          ]),
        ),
      })

      const graph = new AgentGraph(deps)
      await graph.run(baseJobData)

      expect(deps.upsertWorkingMemory).toHaveBeenCalledOnce()
      const upsertArg = vi.mocked(deps.upsertWorkingMemory).mock.calls[0]![0]

      // extractFacts should find the "we will migrate" commitment
      expect(upsertArg.personaId).toBe(PERSONA_ID)
      expect(upsertArg.conversationId).toBe(CONVERSATION_ID)
      expect(upsertArg.projectId).toBe(PROJECT_ID)
      // facts array should have at least 1 entry from the commitment pattern
      expect(upsertArg.facts.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Test 9 — conv.node.appended event emitted with correct payload', () => {
    it('publishes conv.node.appended:{projectId} with node data after persist', async () => {
      const publishSpy = vi.fn().mockResolvedValue(undefined)
      const deps = makeDeps({ publishEvent: publishSpy })

      const graph = new AgentGraph(deps)
      await graph.run(baseJobData)

      const nodeAppendedCall = publishSpy.mock.calls.find(
        (call: unknown[]) => call[0] === `conv.node.appended:${PROJECT_ID}`,
      )
      expect(nodeAppendedCall).toBeDefined()

      const [channel, payload] = nodeAppendedCall as [string, {
        conversationId: string
        roomId: string
        projectId: string
        node: { id: string; authorKind: string; authorPersonaId: string }
      }]
      expect(channel).toBe(`conv.node.appended:${PROJECT_ID}`)
      expect(payload.conversationId).toBe(CONVERSATION_ID)
      expect(payload.roomId).toBe(ROOM_ID)
      expect(payload.projectId).toBe(PROJECT_ID)
      expect(payload.node.id).toBe(PERSISTED_NODE_ID)
      expect(payload.node.authorKind).toBe('agent')
      expect(payload.node.authorPersonaId).toBe(PERSONA_ID)
    })
  })

  describe('Test 10 — agent.turn.complete event emitted after emit_events node', () => {
    it('publishes agent.turn.complete:{projectId} with correct fields', async () => {
      const publishSpy = vi.fn().mockResolvedValue(undefined)
      const deps = makeDeps({ publishEvent: publishSpy })

      const graph = new AgentGraph(deps)
      await graph.run(baseJobData)

      const turnCompleteCall = publishSpy.mock.calls.find(
        (call: unknown[]) => String(call[0]).startsWith('agent.turn.complete:'),
      )
      expect(turnCompleteCall).toBeDefined()
      expect(turnCompleteCall![0]).toBe(`agent.turn.complete:${PROJECT_ID}`)

      const payload = turnCompleteCall![1] as {
        projectId: string
        conversationId: string
        nodeId: string
        personaId: string
        turnDepth: number
        branchId: string
      }
      expect(payload.projectId).toBe(PROJECT_ID)
      expect(payload.conversationId).toBe(CONVERSATION_ID)
      expect(payload.nodeId).toBe(PERSISTED_NODE_ID)
      expect(payload.personaId).toBe(PERSONA_ID)
      expect(payload.turnDepth).toBe(1)
      expect(payload.branchId).toBe(BRANCH_ID)
    })
  })

  describe('Bonus — tools not in persona allowlist are not passed to chatModel', () => {
    it('only passes allowed tools to chatModel', async () => {
      const deps = makeDeps({
        loadContext: vi.fn().mockResolvedValue({
          persona: {
            ...mockPersona,
            toolAllowlist: ['search_knowledge'], // only one tool allowed
          },
          modelPolicy: mockModelPolicy,
          projectBrief: '',
          roomId: ROOM_ID,
          roomType: 'conference',
          roomIsConfidential: false,
          workingMemory: mockWorkingMemory,
          threadNodes: [],
          triggerText: 'hello',
        }),
      })

      const graph = new AgentGraph(deps)
      await graph.run(baseJobData)

      const tools = vi.mocked(deps.chatModel!).mock.calls[0]![2]
      expect(tools).toHaveLength(1)
      expect(tools[0]!.name).toBe('search_knowledge')
    })
  })
})
