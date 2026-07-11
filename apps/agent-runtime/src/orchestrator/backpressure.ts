/**
 * Backpressure — WS slow-consumer detection stub.
 *
 * When a WebSocket client cannot drain fast enough, the realtime gateway
 * drops it to SSE (Server-Sent Events) resume mode. This stub tracks
 * per-connection lag and emits 'drop-to-sse' events when lag exceeds threshold.
 *
 * Full WS→SSE failover implementation: T5 (production hardening).
 * This stub provides the interface contract and basic lag tracking.
 */

export interface BackpressureDeps {
  emitDropToSse: (connectionId: string, lastSeenNodeId: string | null) => void
}

export const BACKPRESSURE_LAG_MS = 5_000 // 5s lag threshold

export class BackpressureMonitor {
  private readonly connectionLag = new Map<string, number>()

  constructor(private readonly deps: BackpressureDeps) {}

  /** Called each time a message is sent to a connection. */
  recordSend(connectionId: string, lagMs: number): void {
    this.connectionLag.set(connectionId, lagMs)
    if (lagMs > BACKPRESSURE_LAG_MS) {
      const lastSeen = null // full tracking: T5
      this.deps.emitDropToSse(connectionId, lastSeen)
      this.connectionLag.delete(connectionId)
    }
  }

  /** Called when connection closes cleanly. */
  onDisconnect(connectionId: string): void {
    this.connectionLag.delete(connectionId)
  }

  /** Current lag for a connection, null if unknown. */
  getLag(connectionId: string): number | null {
    return this.connectionLag.get(connectionId) ?? null
  }
}
