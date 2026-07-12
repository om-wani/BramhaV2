import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Inject,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Redis } from 'ioredis'
import type { Server } from 'socket.io'
import { EventSubscriber } from '@bramha/event-bus'
import { REDIS_CLIENT } from '../common/redis/redis.module.js'

/**
 * Subscribes to all `conv.*` Redis pub/sub channels and relays events to
 * the appropriate Socket.IO room (`room:{roomId}`).
 *
 * The Socket.IO server reference is provided lazily via `setServer()`, which
 * the gateway calls in its `afterInit` hook. This avoids circular injection.
 */
@Injectable()
export class EventRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventRelayService.name)

  private server: Server | null = null
  private subscriber: EventSubscriber | null = null
  private subRedis: Redis | null = null

  constructor(
    // Used only to access the connection string via duplication; the actual
    // publish/subscribe requires a dedicated subscriber connection.
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  /** Called by RealtimeGateway.afterInit() once the Socket.IO server is ready. */
  setServer(server: Server): void {
    this.server = server
  }

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL', 'redis://localhost:6379')
    this.subRedis = new Redis(redisUrl)
    this.subscriber = new EventSubscriber(this.subRedis)

    await this.subscriber.subscribePattern('conv.*', (channel, payload) => {
      this.relayEvent(channel, payload)
    })

    this.logger.log({ event: 'event_relay.subscribed', pattern: 'conv.*' })
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribePattern('conv.*')
      this.subscriber.destroy()
    }
    if (this.subRedis) {
      await this.subRedis.quit()
    }
  }

  /**
   * Disconnect all Socket.IO clients currently in a room channel.
   * Called when a room is archived so clients are evicted within ~5 s.
   */
  kickRoom(roomId: string): void {
    if (!this.server) return
    this.server.in(`room:${roomId}`).disconnectSockets(true)
    this.logger.log({ event: 'event_relay.kick_room', roomId })
  }

  /**
   * Relay a pub/sub message to the matching Socket.IO room.
   * Channel format: `conv.{event_suffix}:{projectId}`
   * Payload must include `roomId`.
   */
  protected relayEvent(channel: string, payload: unknown): void {
    if (!this.server) return

    const p = payload as Record<string, unknown>
    const roomId = p['roomId']
    if (typeof roomId !== 'string') {
      this.logger.warn({ event: 'event_relay.missing_room_id', channel })
      return
    }

    // Strip the :{projectId} suffix to get the event type name
    const colonIdx = channel.indexOf(':')
    const eventType = colonIdx !== -1 ? channel.slice(0, colonIdx) : channel

    this.server.to(`room:${roomId}`).emit(eventType, payload)

    this.logger.log({
      event: 'event_relay.relayed',
      eventType,
      roomId,
    })
  }
}
