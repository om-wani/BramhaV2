/**
 * Per-conversation round-robin queue fairness.
 *
 * Maintains a Redis sorted set `queue:fair:{queueName}` where each
 * member is a conversationId and score is the last-dequeued timestamp.
 * When multiple conversations have jobs pending, always dequeue from
 * the one with the lowest score (longest-waiting).
 *
 * This is advisory — BullMQ still controls actual job execution.
 * The fair-queue layer assigns job priorities so BullMQ naturally
 * processes lower-priority (numerically) jobs first within the queue.
 */

import type { RedisLike } from '@bramha/mcp-connectors'

export interface QueueFairnessDeps {
  redis: RedisLike
}

export class ConversationQueueFairness {
  private readonly key: string

  constructor(
    private readonly queueName: string,
    private readonly deps: QueueFairnessDeps,
  ) {
    this.key = `queue:fair:${queueName}`
  }

  /**
   * Called before adding a job. Returns the BullMQ priority to assign (1–100).
   * Lower number = higher priority in BullMQ.
   * Conversation that has waited longest gets priority 1.
   */
  async getPriority(conversationId: string): Promise<number> {
    // Get current rank of this conversation (0 = waited longest)
    const rank = await this.deps.redis.zrank(this.key, conversationId)
    if (rank === null) {
      // First job for this conversation — add with current timestamp
      await this.deps.redis.zadd(this.key, Date.now(), conversationId)
      return 50 // middle priority until we know relative order
    }
    // Map rank to priority: rank 0 → priority 1, higher rank → higher priority number
    return Math.min(rank + 1, 100)
  }

  /**
   * Called when a conversation's job starts executing.
   * Updates the score to now so it goes to the back of the round-robin.
   */
  async onJobStarted(conversationId: string): Promise<void> {
    await this.deps.redis.zadd(this.key, Date.now(), conversationId)
  }

  /**
   * Prune entries older than 1 hour (idle conversations).
   */
  async pruneStale(olderThanMs = 60 * 60 * 1000): Promise<void> {
    const cutoff = Date.now() - olderThanMs
    await this.deps.redis.zremrangebyscore(this.key, '-inf', cutoff)
  }
}
