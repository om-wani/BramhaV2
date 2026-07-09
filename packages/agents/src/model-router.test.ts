/**
 * ModelRouter unit tests — all providers are mocked; no real LLM calls.
 *
 * Coverage:
 *   1. Normal streaming — all event types forwarded correctly
 *   2. Failover on 429 — primary throws ProviderError(429), fallback succeeds
 *   3. Mid-stream budget abort — aborts when perTurnUSD exceeded
 *   4. Usage math — accumulated tokens exact
 *   5. Circuit breaker — opens after 5 failures, skips provider
 *   6. Hot-reload — different policy → different provider called
 *   7. writeTokenUsage callback — called on success and budget breach
 *   8. Per-day budget — DailyBudgetExceededError thrown before any provider call
 *
 * NOTE on hot-reload DB path: the test in section 6 validates that a fresh
 * policy object routes to the correct provider on each call. The end-to-end
 * DB hot-reload scenario (update agent_model_policies row → next turn loads
 * new model) is tested at the orchestrator service layer in T3.3.1, where
 * fresh policies are fetched from DB per turn. No code change needed here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ModelRouter,
  BudgetExceededError,
  DailyBudgetExceededError,
  clearCircuitBreakers,
  clearProviderCache,
} from './model-router.js'
import type { ModelPolicy, WriteTokenUsageFn } from './model-router.js'
import type { StreamProvider, ProviderChunk } from './providers/types.js'
import { ProviderError } from './providers/types.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makePolicy(overrides: Partial<ModelPolicy> = {}): ModelPolicy {
  return {
    tier: 'csuite',
    primary: { provider: 'mock-a', model: 'model-a' },
    fallbacks: [],
    maxInputTokens: 8000,
    maxOutputTokens: 1024,
    temperature: 0.7,
    budget: { perTurnUSD: 1.0, perDayUSD: 10.0 },
    cache: { promptCaching: false, semanticCacheTTLs: 0 },
    ...overrides,
  }
}

/** Build a mock StreamProvider that yields the given chunks in order */
function makeProvider(name: string, chunks: ProviderChunk[]): StreamProvider {
  return {
    name,
    stream: async function* () {
      for (const chunk of chunks) {
        yield chunk
      }
    },
  }
}

/** Build a mock StreamProvider that throws a ProviderError on stream() */
function makeFailingProvider(name: string, status: number): StreamProvider {
  // Return an IIFE generator — throws on the first iteration. The stream()
  // method returns an AsyncGenerator (not a generator function), so
  // require-yield does not apply to the enclosing method itself.
  return {
    name,
    stream(): AsyncGenerator<ProviderChunk> {
      async function* fail(): AsyncGenerator<ProviderChunk> {
        throw new ProviderError(`${name} error ${status}`, status, name)
        // Unreachable but required to type this as AsyncGenerator<ProviderChunk>
        yield { type: 'content', text: '' }
      }
      return fail()
    },
  }
}

/** Collect all events from ModelRouter.chat into an array */
async function collectEvents(
  policy: ModelPolicy,
  opts: Parameters<typeof ModelRouter.chat>[4] = {},
): Promise<ReturnType<typeof ModelRouter.chat> extends AsyncGenerator<infer T> ? T[] : never> {
  const events: unknown[] = []
  for await (const event of ModelRouter.chat(policy, [], [], undefined, opts)) {
    events.push(event)
  }
  return events as ReturnType<typeof ModelRouter.chat> extends AsyncGenerator<infer T> ? T[] : never
}

// ── Test setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearCircuitBreakers()
  clearProviderCache()
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ModelRouter.chat', () => {
  // ── 1. Normal streaming ────────────────────────────────────────────────────

  it('forwards thought, content, tool_call, and usage events', async () => {
    const chunks: ProviderChunk[] = [
      { type: 'thought', text: 'reasoning...' },
      { type: 'content', text: 'Hello' },
      { type: 'tool_call', callId: 'tc1', name: 'get_weather', input: { city: 'NYC' } },
      { type: 'usage', inputTokens: 100, outputTokens: 50, estimatedUsd: 0.001 },
    ]

    // Arrow function with no parameter: TypeScript allows 0-param functions where 1-param is expected
    const mockFactory = () => makeProvider('mock-a', chunks)
    const policy = makePolicy()
    const events = await collectEvents(policy, { providerFactory: mockFactory })

    expect(events).toHaveLength(4)
    expect(events[0]).toEqual({ type: 'thought', text: 'reasoning...' })
    expect(events[1]).toEqual({ type: 'content', text: 'Hello' })
    expect(events[2]).toEqual({ type: 'tool_call', callId: 'tc1', name: 'get_weather', input: { city: 'NYC' } })
    expect(events[3]).toEqual({ type: 'usage', inputTokens: 100, outputTokens: 50, estimatedUsd: 0.001 })
  })

  // ── 2. Failover on 429 ────────────────────────────────────────────────────

  it('fails over to fallback provider on 429', async () => {
    const fallbackChunks: ProviderChunk[] = [
      { type: 'content', text: 'fallback response' },
      { type: 'usage', inputTokens: 200, outputTokens: 100, estimatedUsd: 0.002 },
    ]

    const mockFactory = (name: string): StreamProvider => {
      if (name === 'mock-primary') return makeFailingProvider('mock-primary', 429)
      return makeProvider('mock-fallback', fallbackChunks)
    }

    const policy = makePolicy({
      primary: { provider: 'mock-primary', model: 'model-a' },
      fallbacks: [{ provider: 'mock-fallback', model: 'model-b' }],
    })

    const events = await collectEvents(policy, { providerFactory: mockFactory })
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ type: 'content', text: 'fallback response' })
  })

  it('fails over on 503 (5xx) errors', async () => {
    const fallbackChunks: ProviderChunk[] = [
      { type: 'content', text: 'ok' },
      { type: 'usage', inputTokens: 10, outputTokens: 5, estimatedUsd: 0.0001 },
    ]

    const mockFactory = (name: string): StreamProvider => {
      if (name === 'mock-primary') return makeFailingProvider('mock-primary', 503)
      return makeProvider('mock-fallback', fallbackChunks)
    }

    const policy = makePolicy({
      primary: { provider: 'mock-primary', model: 'model-a' },
      fallbacks: [{ provider: 'mock-fallback', model: 'model-b' }],
    })

    const events = await collectEvents(policy, { providerFactory: mockFactory })
    expect(events[0]).toEqual({ type: 'content', text: 'ok' })
  })

  it('throws last provider error when all providers fail', async () => {
    const mockFactory = (name: string) => makeFailingProvider(name, 429)

    const policy = makePolicy({
      primary: { provider: 'mock', model: 'model-a' },
      fallbacks: [{ provider: 'mock', model: 'model-b' }],
    })

    await expect(
      collectEvents(policy, { providerFactory: mockFactory }),
    ).rejects.toThrow(ProviderError)
  })

  // ── 3. Mid-stream budget abort ─────────────────────────────────────────────

  it('aborts mid-stream when perTurnUSD is exceeded and throws BudgetExceededError', async () => {
    // Budget is $0.005; the first usage event ($0.006) immediately exceeds it.
    // The router yields the usage event (it already happened), then checks budget
    // and aborts — 'part 2' is never yielded.
    const chunks: ProviderChunk[] = [
      { type: 'content', text: 'part 1' },
      { type: 'usage', inputTokens: 100, outputTokens: 50, estimatedUsd: 0.006 }, // exceeds $0.005
      { type: 'content', text: 'part 2 (should not be yielded)' },
      { type: 'usage', inputTokens: 50, outputTokens: 25, estimatedUsd: 0.003 },
    ]

    const mockFactory = () => makeProvider('mock-a', chunks)
    const policy = makePolicy({
      budget: { perTurnUSD: 0.005, perDayUSD: 10.0 },
    })

    const receivedEvents: unknown[] = []
    let thrownError: unknown = null

    try {
      for await (const event of ModelRouter.chat(policy, [], [], undefined, { providerFactory: mockFactory })) {
        receivedEvents.push(event)
      }
    } catch (err) {
      thrownError = err
    }

    // Should have received: content 'part 1', usage $0.006
    // Router yields usage (already spent), then aborts before 'part 2'
    expect(receivedEvents).toHaveLength(2)
    expect(receivedEvents[0]).toEqual({ type: 'content', text: 'part 1' })
    expect(receivedEvents[1]).toEqual({ type: 'usage', inputTokens: 100, outputTokens: 50, estimatedUsd: 0.006 })
    expect(thrownError).toBeInstanceOf(BudgetExceededError)
  })

  it('BudgetExceededError carries spent and limit amounts', async () => {
    const chunks: ProviderChunk[] = [
      { type: 'usage', inputTokens: 1000, outputTokens: 500, estimatedUsd: 0.02 },
    ]

    const mockFactory = () => makeProvider('mock-a', chunks)
    const policy = makePolicy({ budget: { perTurnUSD: 0.01, perDayUSD: 1.0 } })

    let err: BudgetExceededError | null = null
    try {
      await collectEvents(policy, { providerFactory: mockFactory })
    } catch (e) {
      if (e instanceof BudgetExceededError) err = e
    }

    expect(err).not.toBeNull()
    expect(err!.spentUsd).toBeCloseTo(0.02)
    expect(err!.limitUsd).toBeCloseTo(0.01)
  })

  // ── 4. Usage math ─────────────────────────────────────────────────────────

  it('accumulates usage across multiple usage events', async () => {
    const writeUsage = vi.fn<WriteTokenUsageFn>().mockResolvedValue(undefined)

    const chunks: ProviderChunk[] = [
      { type: 'content', text: 'a' },
      { type: 'usage', inputTokens: 100, outputTokens: 50, estimatedUsd: 0.001 },
      { type: 'content', text: 'b' },
      { type: 'usage', inputTokens: 200, outputTokens: 100, estimatedUsd: 0.002 },
    ]

    const mockFactory = () => makeProvider('mock-a', chunks)
    const policy = makePolicy()

    await collectEvents(policy, {
      providerFactory: mockFactory,
      writeTokenUsage: writeUsage,
      writeTokenUsageContext: { projectId: 'proj-123' },
    })

    // writeTokenUsage called once on success with accumulated totals
    expect(writeUsage).toHaveBeenCalledTimes(1)
    const call = writeUsage.mock.calls[0]![0]
    expect(call.inputTokens).toBe(300)   // 100 + 200
    expect(call.outputTokens).toBe(150)  // 50 + 100
    expect(call.estimatedUsd).toBeCloseTo(0.003)
    expect(call.projectId).toBe('proj-123')
    expect(call.provider).toBe('mock-a')
    expect(call.model).toBe('model-a')
  })

  // ── 5. Circuit breaker ────────────────────────────────────────────────────

  it('opens circuit breaker after 5 failures and skips provider', async () => {
    const successChunks: ProviderChunk[] = [
      { type: 'content', text: 'from fallback' },
      { type: 'usage', inputTokens: 10, outputTokens: 5, estimatedUsd: 0.0001 },
    ]

    const streamSpy = vi.fn((): AsyncGenerator<ProviderChunk> => {
      return makeFailingProvider('mock-primary', 429).stream('model-a', [], [], {
        temperature: 0.7, maxOutputTokens: 1024, promptCaching: false,
      })
    })

    const mockFactory = (name: string): StreamProvider => {
      if (name === 'mock-primary') return { name: 'mock-primary', stream: streamSpy }
      return makeProvider('mock-fallback', successChunks)
    }

    const policy = makePolicy({
      primary: { provider: 'mock-primary', model: 'model-a' },
      fallbacks: [{ provider: 'mock-fallback', model: 'model-b' }],
    })

    // Trip the circuit breaker with 5 failures
    for (let i = 0; i < 5; i++) {
      await collectEvents(policy, { providerFactory: mockFactory }).catch(() => { /* ignore */ })
    }

    // 6th call — circuit is open, should skip primary without calling stream
    const callCountBefore = streamSpy.mock.calls.length
    await collectEvents(policy, { providerFactory: mockFactory })

    // Primary should NOT have been called again — circuit is open
    expect(streamSpy.mock.calls.length).toBe(callCountBefore)
  })

  // ── 6. Hot-reload (stateless per call) ────────────────────────────────────

  it('uses the provider specified in each policy independently (hot-reload)', async () => {
    const providerAStream = vi.fn(async function* (): AsyncGenerator<ProviderChunk> {
      yield { type: 'content', text: 'from A' }
      yield { type: 'usage', inputTokens: 10, outputTokens: 5, estimatedUsd: 0.0001 }
    })
    const providerBStream = vi.fn(async function* (): AsyncGenerator<ProviderChunk> {
      yield { type: 'content', text: 'from B' }
      yield { type: 'usage', inputTokens: 20, outputTokens: 10, estimatedUsd: 0.0002 }
    })

    const mockFactory = (name: string): StreamProvider => {
      if (name === 'mock-a') return { name: 'mock-a', stream: providerAStream }
      return { name: 'mock-b', stream: providerBStream }
    }

    const policyA = makePolicy({ primary: { provider: 'mock-a', model: 'model-a' } })
    const policyB = makePolicy({ primary: { provider: 'mock-b', model: 'model-b' } })

    const eventsA = await collectEvents(policyA, { providerFactory: mockFactory })
    const eventsB = await collectEvents(policyB, { providerFactory: mockFactory })

    expect(eventsA[0]).toEqual({ type: 'content', text: 'from A' })
    expect(eventsB[0]).toEqual({ type: 'content', text: 'from B' })
    expect(providerAStream).toHaveBeenCalledWith('model-a', [], [], expect.any(Object))
    expect(providerBStream).toHaveBeenCalledWith('model-b', [], [], expect.any(Object))
  })

  // ── 7. writeTokenUsage on budget breach ───────────────────────────────────

  it('calls writeTokenUsage with partial usage on budget breach', async () => {
    const writeUsage = vi.fn<WriteTokenUsageFn>().mockResolvedValue(undefined)

    const chunks: ProviderChunk[] = [
      { type: 'usage', inputTokens: 500, outputTokens: 250, estimatedUsd: 0.02 },
    ]

    const mockFactory = () => makeProvider('mock-a', chunks)
    const policy = makePolicy({ budget: { perTurnUSD: 0.01, perDayUSD: 1.0 } })

    try {
      await collectEvents(policy, {
        providerFactory: mockFactory,
        writeTokenUsage: writeUsage,
        writeTokenUsageContext: { projectId: 'proj-xyz', personaId: 'persona-1' },
      })
    } catch {
      // BudgetExceededError expected
    }

    expect(writeUsage).toHaveBeenCalledTimes(1)
    const call = writeUsage.mock.calls[0]![0]
    expect(call.inputTokens).toBe(500)
    expect(call.outputTokens).toBe(250)
    expect(call.estimatedUsd).toBeCloseTo(0.02)
    expect(call.projectId).toBe('proj-xyz')
    expect(call.personaId).toBe('persona-1')
  })

  // ── 8. Per-day budget enforcement ────────────────────────────────────────

  it('throws DailyBudgetExceededError before any provider call when daily limit reached', async () => {
    const streamSpy = vi.fn(async function* (): AsyncGenerator<ProviderChunk> {
      yield { type: 'content', text: 'should not reach here' }
    })
    const mockFactory = () => ({ name: 'mock-a', stream: streamSpy })

    // getDailyUsageUSD returns a value >= perDayUSD
    const getDailyUsageUSD = vi.fn().mockResolvedValue(10.0)

    const policy = makePolicy({ budget: { perTurnUSD: 1.0, perDayUSD: 10.0 } })

    let err: DailyBudgetExceededError | null = null
    try {
      await collectEvents(policy, {
        providerFactory: mockFactory,
        writeTokenUsageContext: { projectId: 'proj-1', personaId: 'persona-1' },
        getDailyUsageUSD,
      })
    } catch (e) {
      if (e instanceof DailyBudgetExceededError) err = e
    }

    expect(err).not.toBeNull()
    expect(err!.spentUsd).toBeCloseTo(10.0)
    expect(err!.limitUsd).toBeCloseTo(10.0)
    // Provider must not have been called — abort happens before streaming
    expect(streamSpy).not.toHaveBeenCalled()
    expect(getDailyUsageUSD).toHaveBeenCalledWith('persona-1', 'proj-1')
  })

  // ── 9. Non-retryable errors propagate immediately ─────────────────────────

  it('propagates non-retryable errors without attempting failover', async () => {
    const fallbackProvider = makeProvider('mock-fallback', [
      { type: 'content', text: 'should not reach here' },
    ])

    const mockFactory = (name: string): StreamProvider => {
      if (name === 'mock-primary') {
        return {
          name: 'mock-primary',
          stream(): AsyncGenerator<ProviderChunk> {
            async function* nonRetryable(): AsyncGenerator<ProviderChunk> {
              throw new Error('authentication_error') // non-retryable (no status field)
              yield { type: 'content', text: '' }    // required for generator typing
            }
            return nonRetryable()
          },
        }
      }
      return fallbackProvider
    }

    const policy = makePolicy({
      primary: { provider: 'mock-primary', model: 'model-a' },
      fallbacks: [{ provider: 'mock-fallback', model: 'model-b' }],
    })

    await expect(
      collectEvents(policy, { providerFactory: mockFactory }),
    ).rejects.toThrow('authentication_error')
  })
})
