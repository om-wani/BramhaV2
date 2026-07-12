import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets'
import {
  Injectable,
  Logger,
  Inject,
  OnModuleDestroy,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Server, Socket } from 'socket.io'
import { Redis } from 'ioredis'
import { createAdapter } from '@socket.io/redis-adapter'
import { REDIS_CLIENT } from '../common/redis/redis.module.js'
import { RlsDbService } from '../common/db/rls-db.service.js'
import { WsAuthGuard, WS_SOCKET_CAP } from './ws-auth.guard.js'
import { EventRelayService } from './event-relay.service.js'

const USER_SOCKETS_KEY = (userId: string): string => `ws:user:${userId}:sockets`

/**
 * Atomic Lua: check per-user socket count and add in one round-trip.
 * Returns 1 if added (under cap), 0 if rejected (at/over cap).
 * Sets a 24-hour TTL so stale entries self-clean after a server crash.
 */
const LUA_SOCKET_CAP_ADD = `
local key   = KEYS[1]
local sid   = ARGV[1]
local cap   = tonumber(ARGV[2])
local count = redis.call('SCARD', key)
if count >= cap then return 0 end
redis.call('SADD', key, sid)
redis.call('EXPIRE', key, 86400)
return 1
`

interface RoomJoinPayload {
  roomId: string
  projectId: string
}

@WebSocketGateway({
  maxHttpBufferSize: 64 * 1024,
  transports: ['websocket', 'polling'],
})
@Injectable()
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server!: Server

  private readonly logger = new Logger(RealtimeGateway.name)

  /** Redis connections created for the Socket.IO adapter — cleaned up in onModuleDestroy. */
  private adapterPub: Redis | null = null
  private adapterSub: Redis | null = null

  constructor(
    private readonly wsAuthGuard: WsAuthGuard,
    private readonly db: RlsDbService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly relayService: EventRelayService,
    private readonly config: ConfigService,
  ) {}

  afterInit(server: Server): void {
    // Wire the Socket.IO server into the relay so it can emit events.
    this.relayService.setServer(server)

    // Attach Redis adapter for multi-instance pub/sub fanout.
    const redisUrl = this.config.get<string>('REDIS_URL', 'redis://localhost:6379')
    this.adapterPub = new Redis(redisUrl)
    this.adapterSub = new Redis(redisUrl)
    server.adapter(createAdapter(this.adapterPub, this.adapterSub))

    this.logger.log({ event: 'realtime.gateway.init' })
  }

  async onModuleDestroy(): Promise<void> {
    await this.adapterPub?.quit()
    await this.adapterSub?.quit()
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  async handleConnection(client: Socket): Promise<void> {
    // 1. JWT auth on handshake
    const userId = await this.wsAuthGuard.verifyHandshake(client)
    if (!userId) return // guard already disconnected the socket

    // 2. Per-user socket cap (5 max) — atomic Lua to eliminate TOCTOU race
    const userKey = USER_SOCKETS_KEY(userId)
    const added = (await this.redis.eval(
      LUA_SOCKET_CAP_ADD,
      1,
      userKey,
      client.id,
      String(WS_SOCKET_CAP),
    )) as number
    if (added === 0) {
      this.logger.warn({ event: 'ws.socket_limit', userId })
      client.emit('system.error', { code: 'socket_limit', message: 'Max concurrent sockets reached' })
      client.disconnect(true)
      return
    }

    // 3. Register userId on socket (Lua already added socketId to the set)
    client.data['userId'] = userId

    this.logger.log({ event: 'ws.connected', userId, socketId: client.id })
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = client.data['userId'] as string | undefined
    if (userId) {
      await this.redis.srem(USER_SOCKETS_KEY(userId), client.id)
      this.logger.log({ event: 'ws.disconnected', userId, socketId: client.id })
    }
  }

  // ── Message handlers ──────────────────────────────────────────────────────

  @SubscribeMessage('room.join')
  async handleRoomJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    // Validate payload shape
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof (payload as RoomJoinPayload).roomId !== 'string' ||
      typeof (payload as RoomJoinPayload).projectId !== 'string'
    ) {
      client.emit('system.error', { code: 'invalid_payload', message: 'Expected { roomId, projectId }' })
      return
    }

    const { roomId, projectId } = payload as RoomJoinPayload
    const userId = client.data['userId'] as string | undefined

    if (!userId) {
      client.emit('system.error', { code: 'not_authenticated', message: 'Not authenticated' })
      return
    }

    // Verify user is a member of the room's project
    let isMember: boolean
    try {
      const rows = await this.db.run({ userId, projectId }, async (tx) => {
        return tx<{ role: string }[]>`
          SELECT role FROM project_members
          WHERE project_id = ${projectId} AND user_id = ${userId}
        `
      })
      isMember = rows.length > 0
    } catch {
      isMember = false
    }

    if (!isMember) {
      this.logger.warn({
        event: 'ws.room_join.not_member',
        userId,
        roomId,
        projectId,
      })
      client.emit('system.error', { code: 'not_member', message: 'Not a member of this project' })
      return // socket stays connected, room NOT joined
    }

    // Also verify the room belongs to the project
    let roomExists: boolean
    try {
      const rows = await this.db.run({ userId, projectId }, async (tx) => {
        return tx<{ id: string }[]>`
          SELECT id FROM rooms WHERE id = ${roomId} AND project_id = ${projectId}
        `
      })
      roomExists = rows.length > 0
    } catch {
      roomExists = false
    }

    if (!roomExists) {
      client.emit('system.error', { code: 'not_found', message: 'Room not found' })
      return
    }

    await client.join(`room:${roomId}`)

    this.logger.log({
      event: 'ws.room_joined',
      userId,
      roomId,
      projectId,
      socketId: client.id,
    })
  }

  @SubscribeMessage('room.leave')
  async handleRoomLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof (payload as { roomId: string }).roomId !== 'string'
    ) {
      client.emit('system.error', { code: 'invalid_payload', message: 'Expected { roomId }' })
      return
    }

    const { roomId } = payload as { roomId: string }
    await client.leave(`room:${roomId}`)

    this.logger.log({
      event: 'ws.room_left',
      userId: client.data['userId'] as string | undefined,
      roomId,
      socketId: client.id,
    })
  }
}
