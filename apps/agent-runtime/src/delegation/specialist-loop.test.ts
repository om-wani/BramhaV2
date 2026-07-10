/**
 * SpecialistLoop unit tests.
 *
 * All external I/O is mocked via SpecialistLoopDeps.
 * No Redis, Postgres, or BullMQ connections are opened.
 *
 * Tests:
 *   1.  Happy path: objective → model call → delegation_report node → completed
 *   2.  Budget USD breach → status=timeout, delegation.timeout emitted
 *   3.  Budget tool calls breach → status=timeout
 *   4.  SECURITY: context bundle contains NO room transcript (snapshot)
 *   5.  report_progress tool: updates progress_pct, emits delegation.progress
 *   6.  delegation.completed emitted with result node ID
 *   7.  Report-back turn enqueued after completion (priority: 10)
 *   8.  On model error → status=failed, delegation.failed emitted
 */

import { describe, it, expect, vi } from 'vitest'
import { runSpecialistLoop } from './specialist-loop.js'
import type { SpecialistLoopDeps, SpecialistContext, SpecialistPersistedNode } from './specialist-loop.js'
import type { DelegationJobData } from './delegation-manager.js'
import type { AgentPersona } from '@bramha/shared'
import type { ModelPolicy, StreamEvent, CoreMessage } from '@bramha/agents'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROJECT_ID = 'a0000001-0000-4000-8000-000000000001'
const CONVERSATION_ID = 'a0000002-0000-4000-8000-000000000002'
const BRANCH_ID = 'a0000003-0000-4000-8000-000000000003'
const ORIGIN_NODE_ID = 'a0000004-0000-4000-8000-000000000004'
const DELEGATING_PERSONA_ID = 'a1000001-0000-4000-8000-000000000011'
const WORKER_PERSONA_ID = 'b2000002-0000-4000-8000-000000000022'
const DELEGATION_ID = 'c3000003-0000-4000-8000-000000000033'
const REPORT_NODE_ID = 'd4000004-0000-4000-8000-000000000044'

const baseJob: DelegationJobData = {
  delegationId: DELEGATION_ID,
  projectId: PROJECT_ID,
  conversationId: CONVERSATION_ID,
  branchId: BRANCH_ID,
  workerSlug: 'researcher',
  objective: 'Research Q4 market trends for B2B SaaS',
  inputs: { market: 'B2B SaaS', region: 'North America' },
  deliverable: 'Market analysis report in markdown',
  budget: {},
  originNodeId: ORIGIN_NODE_ID,
  delegatingPersonaId: DELEGATING_PERSONA_ID,
}

const mockPersona: AgentPersona = {
  id: WORKER_PERSONA_ID,
  scope: 'global',
  projectId: null,
  tier: 'specialist',
  slug: 'researcher',
  name: 'Research Specialist',
  title: 'Researcher',
  avatarKey: null,
  color: null,
  systemPromptTpl: 'You are a research specialist. Complete the task thoroughly.',
  expertiseTags: ['research', 'analysis'],
  speakProfile: { eagerness: 0.5, interruptThreshold: 1.4, silenceBias: 0 },
  delegationAuthority: { canDelegate: [], perTaskBudgetUsd: 0 },
  toolAllowlist: ['search_knowledge', 'report_progress', 'request_approval'],
  enabled: true,
}

const mockModelPolicy: ModelPolicy = {
  tier: 'specialist',
  primary: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  fallbacks: [],
  maxInputTokens: 8192,
  maxOutputTokens: 2048,
  temperature: 0.3,
  budget: { perTurnUSD: 0.05, perDayUSD: 5 },
  cache: { promptCaching: false, semanticCacheTTLs: 0 },
}

const mockCtx: SpecialistContext = {
  persona: mockPersona,
  modelPolicy: mockModelPolicy,
  projectBrief: 'B2B SaaS platform for AI orchestration',  // null also valid
}

const mockPersistedNode: SpecialistPersistedNode = {
  id: REPORT_NODE_ID,
  conversationId: CONVERSATION_ID,
  projectId: PROJECT_ID,
  parentId: ORIGIN_NODE_ID,
  depth: 2,
  path: 'root.origin.report',
  type: 'delegation_report',
  authorKind: 'agent',
  authorUserId: null,
  authorPersonaId: null,
  content: {},
  tokenUsage: null,
  createdAt: new Date().toISOString(),
}

// ── Stream event helpers ───────────────────────────────────────────────────────

/** Create a mock chatModel that yields the provided event sequences per call. */
function makeChatModel(
  callSequences: StreamEvent[][],
): NonNullable<SpecialistLoopDeps['chatModel']> {
  let callIndex = 0
  return async function* () {
    // eslint-disable-next-line security/detect-object-injection
    const events = callSequences[callIndex] ?? ([{ type: 'content', text: 'default' }] as StreamEvent[])
    callIndex++
    for (const event of events) {
      yield event
    }
  }
}

// ── Dep factory ───────────────────────────────────────────────────────────────

function makeDeps(
  overrides: Partial<SpecialistLoopDeps> = {},
): SpecialistLoopDeps {
  return {
    redis: {} as SpecialistLoopDeps['redis'],

    loadContext: vi.fn().mockResolvedValue(mockCtx),
    searchKnowledge: vi.fn().mockResolvedValue([]),

    chatModel: makeChatModel([
      [{ type: 'content', text: 'Research complete: Here is the analysis.' }],
    ]),

    insertNode: vi.fn().mockResolvedValue(mockPersistedNode),
    upsertDelegation: vi.fn().mockResolvedValue(undefined),
    publishEvent: vi.fn().mockResolvedValue(undefined),
    enqueueTurn: vi.fn().mockResolvedValue(undefined),

    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runSpecialistLoop', () => {
  it('1. happy path: inserts delegation_report node and marks status=completed', async () => {
    const deps = makeDeps()

    await runSpecialistLoop(baseJob, deps)

    // Node should be inserted with correct type
    expect(deps.insertNode).toHaveBeenCalledOnce()
    const nodeCall = vi.mocked(deps.insertNode).mock.calls[0]![0]
    expect(nodeCall.type).toBe('delegation_report')
    expect(nodeCall.parentId).toBe(ORIGIN_NODE_ID)
    expect((nodeCall.content as Record<string, unknown>)['delegationId']).toBe(DELEGATION_ID)

    // Delegation should be marked completed
    const upsertCalls = vi.mocked(deps.upsertDelegation).mock.calls
    const completedCall = upsertCalls.find(([, update]) => update.status === 'completed')
    expect(completedCall).toBeDefined()
    expect(completedCall![1].result).toMatchObject({ node_id: REPORT_NODE_ID })
  })

  it('1b. marks running at start then completed at end', async () => {
    const deps = makeDeps()

    await runSpecialistLoop(baseJob, deps)

    const upsertCalls = vi.mocked(deps.upsertDelegation).mock.calls
    const statuses = upsertCalls.map(([, u]) => u.status).filter(Boolean)
    expect(statuses[0]).toBe('running')
    expect(statuses[statuses.length - 1]).toBe('completed')
  })

  it('2. sets status=timeout and emits delegation.timeout on USD budget breach', async () => {
    // Model call on loop 1: returns tool_call (forces another iteration)
    // After that: usdSpent exceeds maxUsd → timeout on loop 2 pre-check
    const chatModel = makeChatModel([
      // First call: returns tool_call + high usage
      [
        { type: 'usage', inputTokens: 1000, outputTokens: 500, estimatedUsd: 0.5 },
        { type: 'tool_call', callId: 'tc1', name: 'search_knowledge', input: { query: 'test' } },
      ],
    ])

    const deps = makeDeps({
      chatModel,
    })

    const jobWithBudget: DelegationJobData = {
      ...baseJob,
      budget: { maxUsd: 0.01 }, // 0.01 USD cap; first call costs 0.5 USD
    }

    await runSpecialistLoop(jobWithBudget, deps)

    const upsertCalls = vi.mocked(deps.upsertDelegation).mock.calls
    const timeoutCall = upsertCalls.find(([, u]) => u.status === 'timeout')
    expect(timeoutCall).toBeDefined()
    expect(timeoutCall![1].result).toMatchObject({ budget_breach: true })

    const publishCalls = vi.mocked(deps.publishEvent).mock.calls
    const timeoutEvent = publishCalls.find(([ch]) => ch.startsWith('delegation.timeout:'))
    expect(timeoutEvent).toBeDefined()
    expect(timeoutEvent![0]).toBe(`delegation.timeout:${PROJECT_ID}`)
  })

  it('3. sets status=timeout on tool calls budget breach', async () => {
    // maxToolCalls = 1; model makes a tool call, toolCallsUsed becomes 1 → breach
    const chatModel = makeChatModel([
      // First call: returns two tool calls (second one will exceed budget)
      [
        { type: 'tool_call', callId: 'tc1', name: 'search_knowledge', input: { query: 'q1' } },
        { type: 'tool_call', callId: 'tc2', name: 'search_knowledge', input: { query: 'q2' } },
      ],
    ])

    const deps = makeDeps({ chatModel })

    const jobWithBudget: DelegationJobData = {
      ...baseJob,
      budget: { maxToolCalls: 1 }, // only 1 tool call allowed
    }

    await runSpecialistLoop(jobWithBudget, deps)

    const upsertCalls = vi.mocked(deps.upsertDelegation).mock.calls
    const timeoutCall = upsertCalls.find(([, u]) => u.status === 'timeout')
    expect(timeoutCall).toBeDefined()
  })

  it('4. SECURITY: context bundle passed to model contains NO room transcript', async () => {
    let capturedMessages: CoreMessage[] = []

    const chatModel: SpecialistLoopDeps['chatModel'] = async function* (_policy, messages) {
      capturedMessages = messages
      yield { type: 'content', text: 'Done.' }
    }

    const deps = makeDeps({ chatModel })
    await runSpecialistLoop(baseJob, deps)

    // Assert 1: loadContext is called without thread nodes (SpecialistContext has none)
    expect(vi.mocked(deps.loadContext)).toHaveBeenCalledOnce()
    const loadContextCall = vi.mocked(deps.loadContext).mock.calls[0]![0]
    expect(loadContextCall).not.toHaveProperty('threadNodes')
    expect(loadContextCall).not.toHaveProperty('conversationId') // not part of loadContext args

    // Assert 2: messages passed to model do not contain conversation_node data
    // The context should only contain system prompt + task spec + RAG
    expect(capturedMessages.length).toBeGreaterThanOrEqual(2) // system + user
    expect(capturedMessages.length).toBeLessThanOrEqual(3)    // no extra thread messages

    // System message should be the persona system prompt, not a room transcript
    const systemMsg = capturedMessages.find(m => m.role === 'system')
    expect(systemMsg).toBeDefined()
    expect(systemMsg!.content).toBe(mockPersona.systemPromptTpl)

    // User message should contain SPECIALIST TASK prefix (not a room thread)
    const userMsg = capturedMessages.find(m => m.role === 'user')
    expect(userMsg).toBeDefined()
    expect(typeof userMsg!.content).toBe('string')
    expect(userMsg!.content).toContain('SPECIALIST TASK')
    expect(userMsg!.content).toContain(baseJob.objective)

    // Critically: no conversation_nodes content present
    const allContent = capturedMessages
      .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n')
    expect(allContent).not.toContain('conversation_node')
    expect(allContent).not.toContain('thread_window')
    expect(allContent).not.toContain('working_memory')
  })

  it('5. report_progress tool: upserts delegation and emits delegation.progress', async () => {
    // Model: first call returns report_progress, second call returns final content
    const chatModel = makeChatModel([
      [
        { type: 'tool_call', callId: 'tc1', name: 'report_progress', input: { pct: 50, note: 'Halfway done' } },
      ],
      [
        { type: 'content', text: 'Research complete.' },
      ],
    ])

    const deps = makeDeps({ chatModel })

    await runSpecialistLoop(baseJob, deps)

    // upsertDelegation should have been called for progress
    const upsertCalls = vi.mocked(deps.upsertDelegation).mock.calls
    const progressCall = upsertCalls.find(([, u]) => {
      const result = u.result as Record<string, unknown> | undefined
      return result?.['progress_pct'] === 50
    })
    expect(progressCall).toBeDefined()

    // delegation.progress should have been emitted
    const publishCalls = vi.mocked(deps.publishEvent).mock.calls
    const progressEvent = publishCalls.find(([ch]) => ch.startsWith('delegation.progress:'))
    expect(progressEvent).toBeDefined()
    expect(progressEvent![0]).toBe(`delegation.progress:${PROJECT_ID}`)
    expect(progressEvent![1]).toMatchObject({
      delegationId: DELEGATION_ID,
      progressPct: 50,
      note: 'Halfway done',
    })
  })

  it('6. emits delegation.completed with result node ID after completion', async () => {
    const deps = makeDeps()

    await runSpecialistLoop(baseJob, deps)

    const publishCalls = vi.mocked(deps.publishEvent).mock.calls
    const completedEvent = publishCalls.find(([ch]) => ch.startsWith('delegation.completed:'))
    expect(completedEvent).toBeDefined()
    expect(completedEvent![0]).toBe(`delegation.completed:${PROJECT_ID}`)
    expect(completedEvent![1]).toMatchObject({
      delegationId: DELEGATION_ID,
      projectId: PROJECT_ID,
      resultNodeId: REPORT_NODE_ID,
    })
  })

  it('7. enqueues LOW-priority report-back turn (priority: 10) after completion', async () => {
    const deps = makeDeps()

    await runSpecialistLoop(baseJob, deps)

    expect(deps.enqueueTurn).toHaveBeenCalledOnce()
    const [jobData, opts] = vi.mocked(deps.enqueueTurn).mock.calls[0]!

    expect(jobData.personaId).toBe(DELEGATING_PERSONA_ID)
    expect(jobData.triggerReason).toBe('follow-up')
    expect(jobData.triggerNodeId).toBe(REPORT_NODE_ID)
    expect(jobData.projectId).toBe(PROJECT_ID)
    expect(jobData.conversationId).toBe(CONVERSATION_ID)
    expect(jobData.branchId).toBe(BRANCH_ID)
    expect(opts?.priority).toBe(10)
  })

  it('8. sets status=failed and emits delegation.failed on model error', async () => {
    // eslint-disable-next-line require-yield
    const chatModel: SpecialistLoopDeps['chatModel'] = async function* () {
      throw new Error('LLM provider timeout')
    }

    const deps = makeDeps({ chatModel })

    await runSpecialistLoop(baseJob, deps)

    const upsertCalls = vi.mocked(deps.upsertDelegation).mock.calls
    const failedCall = upsertCalls.find(([, u]) => u.status === 'failed')
    expect(failedCall).toBeDefined()
    expect(failedCall![1].result).toMatchObject({ error: 'LLM provider timeout' })

    const publishCalls = vi.mocked(deps.publishEvent).mock.calls
    const failedEvent = publishCalls.find(([ch]) => ch.startsWith('delegation.failed:'))
    expect(failedEvent).toBeDefined()
    expect(failedEvent![0]).toBe(`delegation.failed:${PROJECT_ID}`)

    // Should NOT enqueue report-back turn on failure
    expect(deps.enqueueTurn).not.toHaveBeenCalled()
    // Should NOT insert node on failure
    expect(deps.insertNode).not.toHaveBeenCalled()
  })

  it('8b. does not re-throw on model error (BullMQ job marked completed)', async () => {
    // eslint-disable-next-line require-yield
    const chatModel: SpecialistLoopDeps['chatModel'] = async function* () {
      throw new Error('unexpected error')
    }

    const deps = makeDeps({ chatModel })

    // Should not throw — error is handled internally
    await expect(runSpecialistLoop(baseJob, deps)).resolves.toBeUndefined()
  })

  it('emits delegation.started on entry', async () => {
    const deps = makeDeps()

    await runSpecialistLoop(baseJob, deps)

    const publishCalls = vi.mocked(deps.publishEvent).mock.calls
    const startedEvent = publishCalls.find(([ch]) => ch.startsWith('delegation.started:'))
    expect(startedEvent).toBeDefined()
    expect(startedEvent![0]).toBe(`delegation.started:${PROJECT_ID}`)
  })
})
