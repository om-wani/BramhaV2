import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventPublisher, EventSubscriber, Channels } from './index.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal ioredis mock — only the methods we call. */
function makeRedisMock() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()

  return {
    publish: vi.fn().mockResolvedValue(1),
    psubscribe: vi.fn().mockResolvedValue(undefined),
    punsubscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockImplementation((event: string, fn: (...args: unknown[]) => void) => {
      const arr = listeners.get(event) ?? []
      arr.push(fn)
      listeners.set(event, arr)
    }),
    removeListener: vi.fn(),
    /** Simulate an incoming pmessage from Redis. */
    emit(event: string, ...args: unknown[]) {
      const fns = listeners.get(event) ?? []
      for (const fn of fns) fn(...args)
    },
  }
}

// ── Channels ──────────────────────────────────────────────────────────────────

describe('Channels', () => {
  it('builds correct channel strings', () => {
    expect(Channels.convNodeAppended('proj-123')).toBe('conv.node.appended:proj-123')
    expect(Channels.convBranchForked('proj-abc')).toBe('conv.branch.forked:proj-abc')
    expect(Channels.convBranchUpdated('proj-xyz')).toBe('conv.branch.updated:proj-xyz')
  })
})

// ── EventPublisher ────────────────────────────────────────────────────────────

describe('EventPublisher', () => {
  let redis: ReturnType<typeof makeRedisMock>
  let publisher: EventPublisher

  beforeEach(() => {
    redis = makeRedisMock()
    publisher = new EventPublisher(redis as unknown as import('ioredis').Redis)
  })

  it('calls redis.publish with the correct channel and JSON-serialised payload', async () => {
    // Use proper v4 UUIDs (version digit = 4, variant digit = 8-b)
    const convId = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5'
    const roomId = 'b1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5'
    const projId = 'c1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5'
    const nodeId = 'd1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5'
    const userId = 'e1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5'

    const payload = {
      conversationId: convId,
      roomId,
      projectId: projId,
      node: {
        id: nodeId,
        conversationId: convId,
        projectId: projId,
        parentId: null,
        depth: 0,
        path: '0001',
        type: 'message',
        authorKind: 'user',
        authorUserId: userId,
        authorPersonaId: null,
        content: { text: 'hello' },
        tokenUsage: null,
        createdAt: '2024-01-01T00:00:00Z',
      },
    }

    const channel = Channels.convNodeAppended(projId)
    await publisher.publish(channel, payload)

    expect(redis.publish).toHaveBeenCalledOnce()
    expect(redis.publish).toHaveBeenCalledWith(channel, JSON.stringify(payload))
  })

  it('throws ZodError if payload fails schema validation', async () => {
    const badPayload = { conversationId: 'not-a-uuid', roomId: 'bad', projectId: 'bad', node: {} }
    await expect(
      publisher.publish(Channels.convNodeAppended('proj-1'), badPayload),
    ).rejects.toThrow()
    expect(redis.publish).not.toHaveBeenCalled()
  })

  it('publishes without schema validation for unknown channels', async () => {
    await publisher.publish('custom.channel:proj-1', { arbitrary: true })
    expect(redis.publish).toHaveBeenCalledWith('custom.channel:proj-1', JSON.stringify({ arbitrary: true }))
  })
})

// ── EventSubscriber ───────────────────────────────────────────────────────────

describe('EventSubscriber', () => {
  let redis: ReturnType<typeof makeRedisMock>
  let subscriber: EventSubscriber

  beforeEach(() => {
    redis = makeRedisMock()
    subscriber = new EventSubscriber(redis as unknown as import('ioredis').Redis)
  })

  it('calls psubscribe and registers the handler', async () => {
    const handler = vi.fn()
    await subscriber.subscribePattern('conv.*', handler)
    expect(redis.psubscribe).toHaveBeenCalledWith('conv.*')
  })

  it('invokes the handler with parsed payload on a matching pmessage', async () => {
    const handler = vi.fn()
    await subscriber.subscribePattern('conv.*', handler)

    const payload = { roomId: 'room-1', projectId: 'proj-1', conversationId: 'conv-1', node: {} }
    redis.emit('pmessage', 'conv.*', 'conv.node.appended:proj-1', JSON.stringify(payload))

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith('conv.node.appended:proj-1', payload)
  })

  it('does NOT call handler for a different pattern', async () => {
    const handler = vi.fn()
    await subscriber.subscribePattern('conv.*', handler)

    // Fire a pmessage for a different pattern
    redis.emit('pmessage', 'other.*', 'other.event:proj-1', JSON.stringify({ x: 1 }))

    expect(handler).not.toHaveBeenCalled()
  })

  it('silently drops malformed JSON — handler is NOT called', async () => {
    const handler = vi.fn()
    await subscriber.subscribePattern('conv.*', handler)

    redis.emit('pmessage', 'conv.*', 'conv.node.appended:proj-1', 'NOT-VALID-JSON{{{')

    expect(handler).not.toHaveBeenCalled()
  })

  it('does not throw on malformed JSON', () => {
    subscriber.subscribePattern('conv.*', vi.fn())
    expect(() => {
      redis.emit('pmessage', 'conv.*', 'conv.node.appended:proj-1', '}{bad json')
    }).not.toThrow()
  })

  it('unsubscribes from the pattern and removes the handler', async () => {
    const handler = vi.fn()
    await subscriber.subscribePattern('conv.*', handler)
    await subscriber.unsubscribePattern('conv.*')

    expect(redis.punsubscribe).toHaveBeenCalledWith('conv.*')

    // Handler should no longer be called after unsubscribe
    redis.emit('pmessage', 'conv.*', 'conv.node.appended:proj-1', JSON.stringify({ x: 1 }))
    expect(handler).not.toHaveBeenCalled()
  })

  it('destroy() removes the pmessage listener from the Redis instance', () => {
    subscriber.destroy()
    expect(redis.removeListener).toHaveBeenCalledWith('pmessage', expect.any(Function))
  })
})
