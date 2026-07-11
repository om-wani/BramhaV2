/**
 * BackpressureMonitor unit tests.
 *
 * Verifies lag tracking and drop-to-SSE emission behaviour.
 * No I/O — purely in-memory.
 */

import { describe, it, expect, vi } from 'vitest'
import { BackpressureMonitor, BACKPRESSURE_LAG_MS } from './backpressure.js'
import type { BackpressureDeps } from './backpressure.js'

// ── Factory ───────────────────────────────────────────────────────────────────

function makeDeps(overrides?: Partial<BackpressureDeps>): BackpressureDeps {
  return {
    emitDropToSse: vi.fn(),
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BackpressureMonitor.recordSend — below threshold', () => {
  it('does NOT emit drop-to-sse when lagMs is below threshold', () => {
    const deps = makeDeps()
    const monitor = new BackpressureMonitor(deps)

    monitor.recordSend('conn-1', BACKPRESSURE_LAG_MS - 1)

    expect(deps.emitDropToSse).not.toHaveBeenCalled()
  })

  it('does NOT emit drop-to-sse when lagMs is exactly at threshold', () => {
    const deps = makeDeps()
    const monitor = new BackpressureMonitor(deps)

    monitor.recordSend('conn-2', BACKPRESSURE_LAG_MS)

    expect(deps.emitDropToSse).not.toHaveBeenCalled()
  })

  it('records lag in internal map for connections below threshold', () => {
    const deps = makeDeps()
    const monitor = new BackpressureMonitor(deps)

    monitor.recordSend('conn-3', 1234)

    expect(monitor.getLag('conn-3')).toBe(1234)
  })
})

describe('BackpressureMonitor.recordSend — above threshold', () => {
  it('emits drop-to-sse when lagMs exceeds threshold', () => {
    const deps = makeDeps()
    const monitor = new BackpressureMonitor(deps)

    monitor.recordSend('conn-4', BACKPRESSURE_LAG_MS + 1)

    expect(deps.emitDropToSse).toHaveBeenCalledOnce()
    const [connectionId, lastSeen] = (deps.emitDropToSse as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string | null]
    expect(connectionId).toBe('conn-4')
    expect(lastSeen).toBeNull() // stub: full tracking deferred to T5
  })

  it('removes connection from internal map after drop-to-sse', () => {
    const deps = makeDeps()
    const monitor = new BackpressureMonitor(deps)

    monitor.recordSend('conn-5', BACKPRESSURE_LAG_MS + 100)

    // Connection should be gone from map after drop
    expect(monitor.getLag('conn-5')).toBeNull()
  })

  it('only emits once per over-threshold send (connection removed)', () => {
    const deps = makeDeps()
    const monitor = new BackpressureMonitor(deps)

    // First over-threshold send emits drop-to-sse and removes connection
    monitor.recordSend('conn-6', BACKPRESSURE_LAG_MS + 100)
    // Second send re-registers connection with new lag (below threshold this time)
    monitor.recordSend('conn-6', 100)

    expect(deps.emitDropToSse).toHaveBeenCalledOnce()
  })

  it('emits drop-to-sse only once even if second recordSend also exceeds threshold', () => {
    const deps = makeDeps()
    const monitor = new BackpressureMonitor(deps)

    monitor.recordSend('conn-6b', BACKPRESSURE_LAG_MS + 1_000)  // above threshold → emit
    monitor.recordSend('conn-6b', BACKPRESSURE_LAG_MS + 2_000)  // still above threshold → must NOT emit again

    expect(deps.emitDropToSse).toHaveBeenCalledTimes(1)
  })
})

describe('BackpressureMonitor.onDisconnect', () => {
  it('removes connection from internal map', () => {
    const deps = makeDeps()
    const monitor = new BackpressureMonitor(deps)

    monitor.recordSend('conn-7', 500)
    expect(monitor.getLag('conn-7')).toBe(500)

    monitor.onDisconnect('conn-7')

    expect(monitor.getLag('conn-7')).toBeNull()
  })

  it('is a no-op for unknown connections', () => {
    const deps = makeDeps()
    const monitor = new BackpressureMonitor(deps)

    // Should not throw
    expect(() => monitor.onDisconnect('conn-unknown')).not.toThrow()
  })
})

describe('BackpressureMonitor.getLag', () => {
  it('returns current lag for a tracked connection', () => {
    const deps = makeDeps()
    const monitor = new BackpressureMonitor(deps)

    monitor.recordSend('conn-8', 2500)

    expect(monitor.getLag('conn-8')).toBe(2500)
  })

  it('returns null for an unknown connection', () => {
    const deps = makeDeps()
    const monitor = new BackpressureMonitor(deps)

    expect(monitor.getLag('conn-unknown-2')).toBeNull()
  })

  it('returns the most recently recorded lag after multiple sends', () => {
    const deps = makeDeps()
    const monitor = new BackpressureMonitor(deps)

    monitor.recordSend('conn-9', 100)
    monitor.recordSend('conn-9', 200)
    monitor.recordSend('conn-9', 300)

    expect(monitor.getLag('conn-9')).toBe(300)
  })
})
