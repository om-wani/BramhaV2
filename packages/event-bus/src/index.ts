import type { Redis } from 'ioredis'
import {
  ConvNodeAppendedPayloadSchema,
  ConvBranchForkedPayloadSchema,
  ConvBranchUpdatedPayloadSchema,
} from '@bramha/shared'

// Re-export payload types and schemas for consumers
export {
  ConvNodeAppendedPayloadSchema,
  ConvBranchForkedPayloadSchema,
  ConvBranchUpdatedPayloadSchema,
} from '@bramha/shared'
export type {
  ConvNodeAppendedPayload,
  ConvBranchForkedPayload,
  ConvBranchUpdatedPayload,
} from '@bramha/shared'

// ── Channel builders ──────────────────────────────────────────────────────────
// Channel pattern: `{event_type}:{projectId}`

export const Channels = {
  convNodeAppended: (projectId: string): string => `conv.node.appended:${projectId}`,
  convBranchForked: (projectId: string): string => `conv.branch.forked:${projectId}`,
  convBranchUpdated: (projectId: string): string => `conv.branch.updated:${projectId}`,
} as const

// ── Schema map for publish-time validation ────────────────────────────────────

/** Minimal interface satisfied by all Zod schemas. */
interface ParseableSchema {
  parse: (value: unknown) => unknown
}

const CHANNEL_SCHEMAS: Map<string, ParseableSchema> = new Map([
  ['conv.node.appended', ConvNodeAppendedPayloadSchema as ParseableSchema],
  ['conv.branch.forked', ConvBranchForkedPayloadSchema as ParseableSchema],
  ['conv.branch.updated', ConvBranchUpdatedPayloadSchema as ParseableSchema],
])

function schemaForChannel(channel: string) {
  // Channel format: `{event_type}:{projectId}` — strip the projectId suffix
  const colonIdx = channel.indexOf(':')
  const eventType = colonIdx !== -1 ? channel.slice(0, colonIdx) : channel
  return CHANNEL_SCHEMAS.get(eventType)
}

// ── EventPublisher ────────────────────────────────────────────────────────────

/**
 * Thin wrapper around ioredis `PUBLISH`.
 * Validates payloads against Zod schemas before serialising.
 * Use the shared (non-subscriber) Redis connection.
 */
export class EventPublisher {
  constructor(private readonly redis: Redis) {}

  /**
   * Validate `payload` against the schema registered for `channel`, then publish.
   * Throws a `ZodError` if validation fails — callers should handle (or wrap in
   * fire-and-forget `.catch()`).
   */
  async publish(channel: string, payload: unknown): Promise<void> {
    const schema = schemaForChannel(channel)
    const validated = schema ? schema.parse(payload) : payload
    await this.redis.publish(channel, JSON.stringify(validated))
  }
}

// ── EventSubscriber ───────────────────────────────────────────────────────────

/**
 * Wrapper around ioredis `PSUBSCRIBE` for glob-pattern subscriptions.
 *
 * IMPORTANT: the Redis instance passed here MUST be a dedicated subscriber
 * connection — once subscribed, it cannot be used for other commands.
 */
export class EventSubscriber {
  private readonly handlers = new Map<
    string,
    (channel: string, payload: unknown) => void
  >()

  private readonly pmessageListener: (
    pattern: string,
    channel: string,
    message: string,
  ) => void

  constructor(private readonly redis: Redis) {
    this.pmessageListener = (pattern: string, channel: string, message: string) => {
      const handler = this.handlers.get(pattern)
      if (!handler) return
      try {
        handler(channel, JSON.parse(message) as unknown)
      } catch {
        // swallow JSON parse errors — malformed payloads are silently dropped
      }
    }
    this.redis.on('pmessage', this.pmessageListener)
  }

  /**
   * Subscribe to a Redis glob pattern (e.g. `conv.*`).
   * The handler receives the matched channel name and the parsed payload.
   * Calling this method multiple times with the same pattern replaces the handler.
   */
  async subscribePattern(
    pattern: string,
    handler: (channel: string, payload: unknown) => void,
  ): Promise<void> {
    this.handlers.set(pattern, handler)
    await this.redis.psubscribe(pattern)
  }

  /**
   * Unsubscribe from a pattern and remove its handler.
   */
  async unsubscribePattern(pattern: string): Promise<void> {
    this.handlers.delete(pattern)
    await this.redis.punsubscribe(pattern)
  }

  /**
   * Remove the pmessage listener from the Redis connection.
   * Call this when the subscriber is no longer needed.
   */
  destroy(): void {
    this.redis.removeListener('pmessage', this.pmessageListener)
  }
}
