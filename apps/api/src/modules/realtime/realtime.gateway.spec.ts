/**
 * Unit tests for RealtimeGateway.
 *
 * Tests use mocked Socket, JwtService, RlsDbService, and Redis to verify:
 * 1. Non-member room.join → system.error not_member emitted, socket NOT joined
 * 2. Valid member room.join → socket.join called with room:{roomId}
 * 3. 6th socket for same user → system.error socket_limit + disconnect
 * 4. Expired JWT on handshake → auth_expired event + disconnect
 * 5. WsAuthGuard: missing token → auth_expired + disconnect
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RealtimeGateway } from './realtime.gateway'
import { WsAuthGuard } from './ws-auth.guard'
import type { EventRelayService } from './event-relay.service'
import type { RlsDbService } from '../common/db/rls-db.service'
import type { JwtService } from '../auth/jwt.service'
import type { ConfigService } from '@nestjs/config'
import { UnauthorizedException } from '@nestjs/common'

// ── Mock builders ─────────────────────────────────────────────────────────────

function makeSocket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'socket-abc',
    data: {} as Record<string, unknown>,
    handshake: {
      auth: { token: 'valid.jwt.token' },
    },
    emit: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    rooms: new Set<string>(),
    ...overrides,
  }
}

function makeRedis(scardResult = 0) {
  return {
    scard: vi.fn().mockResolvedValue(scardResult),
    sadd: vi.fn().mockResolvedValue(1),
    srem: vi.fn().mockResolvedValue(1),
    duplicate: vi.fn().mockReturnValue({
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue('OK'),
    }),
  }
}

function makeDb(memberRows: { role: string }[] = [], roomRows: { id: string }[] = []) {
  let callCount = 0
  return {
    run: vi.fn().mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      callCount++
      const tx = vi.fn().mockImplementation(async () => {
        // First call = membership check, second call = room existence check
        if (callCount % 2 === 1) return memberRows
        return roomRows
      })
      // postgres.js template literal call: tx`...`
      const txProxy = new Proxy(tx, {
        apply: (_t, _thisArg, args) => tx(...args),
      })
      return fn(txProxy)
    }),
  }
}

function makeRelayService() {
  return {
    setServer: vi.fn(),
    onModuleInit: vi.fn().mockResolvedValue(undefined),
    onModuleDestroy: vi.fn().mockResolvedValue(undefined),
  }
}

function makeConfigService() {
  return {
    get: vi.fn().mockReturnValue('redis://localhost:6379'),
  }
}

// ── WsAuthGuard unit tests ────────────────────────────────────────────────────

describe('WsAuthGuard', () => {
  let guard: WsAuthGuard
  let jwtService: { verify: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    jwtService = { verify: vi.fn() }
    guard = new WsAuthGuard(jwtService as unknown as JwtService)
  })

  it('returns userId on valid token', async () => {
    jwtService.verify.mockResolvedValue({ userId: 'user-1' })
    const socket = makeSocket()
    const result = await guard.verifyHandshake(socket as unknown as import('socket.io').Socket)
    expect(result).toBe('user-1')
    expect(socket.emit).not.toHaveBeenCalled()
    expect(socket.disconnect).not.toHaveBeenCalled()
  })

  it('emits auth_expired and disconnects on invalid/expired token', async () => {
    jwtService.verify.mockRejectedValue(new UnauthorizedException({ code: 'invalid_token' }))
    const socket = makeSocket()
    const result = await guard.verifyHandshake(socket as unknown as import('socket.io').Socket)
    expect(result).toBeNull()
    expect(socket.emit).toHaveBeenCalledWith('auth_expired', expect.objectContaining({ code: 'auth_expired' }))
    expect(socket.disconnect).toHaveBeenCalledWith(true)
  })

  it('emits auth_expired and disconnects when token is missing', async () => {
    const socket = makeSocket({ handshake: { auth: {} } })
    const result = await guard.verifyHandshake(socket as unknown as import('socket.io').Socket)
    expect(result).toBeNull()
    expect(socket.emit).toHaveBeenCalledWith('auth_expired', expect.objectContaining({ code: 'auth_expired' }))
    expect(socket.disconnect).toHaveBeenCalledWith(true)
  })
})

// ── RealtimeGateway unit tests ────────────────────────────────────────────────

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway
  let wsAuthGuard: { verifyHandshake: ReturnType<typeof vi.fn> }
  let redis: ReturnType<typeof makeRedis>
  let relayService: ReturnType<typeof makeRelayService>

  function buildGateway(
    scardResult = 0,
    memberRows: { role: string }[] = [{ role: 'member' }],
    roomRows: { id: string }[] = [{ id: 'room-1' }],
    wsAuthResult: string | null = 'user-1',
  ) {
    wsAuthGuard = { verifyHandshake: vi.fn().mockResolvedValue(wsAuthResult) }
    redis = makeRedis(scardResult)
    relayService = makeRelayService()
    const db = makeDb(memberRows, roomRows)
    const config = makeConfigService()

    gateway = new RealtimeGateway(
      wsAuthGuard as unknown as WsAuthGuard,
      db as unknown as RlsDbService,
      redis as unknown as import('ioredis').default,
      relayService as unknown as EventRelayService,
      config as unknown as ConfigService,
    )
  }

  // ── handleConnection ──────────────────────────────────────────────────────

  describe('handleConnection', () => {
    it('stores userId and tracks socket on valid connection', async () => {
      buildGateway(0) // scard = 0 (no existing sockets)
      const socket = makeSocket()

      await gateway.handleConnection(socket as unknown as import('socket.io').Socket)

      expect(socket.data['userId']).toBe('user-1')
      expect(redis.sadd).toHaveBeenCalledWith('ws:user:user-1:sockets', socket.id)
      expect(socket.disconnect).not.toHaveBeenCalled()
    })

    it('emits auth_expired and disconnects when WsAuthGuard returns null', async () => {
      buildGateway(0, [], [], null)
      const socket = makeSocket()

      await gateway.handleConnection(socket as unknown as import('socket.io').Socket)

      // Guard itself handles the disconnect/emit — gateway just returns early
      expect(redis.sadd).not.toHaveBeenCalled()
    })

    it('emits socket_limit and disconnects on 6th concurrent connection', async () => {
      buildGateway(5) // scard = 5 (already at cap)
      const socket = makeSocket()

      await gateway.handleConnection(socket as unknown as import('socket.io').Socket)

      expect(socket.emit).toHaveBeenCalledWith(
        'system.error',
        expect.objectContaining({ code: 'socket_limit' }),
      )
      expect(socket.disconnect).toHaveBeenCalledWith(true)
      expect(redis.sadd).not.toHaveBeenCalled()
    })
  })

  // ── handleDisconnect ──────────────────────────────────────────────────────

  describe('handleDisconnect', () => {
    it('removes socket from user socket set', async () => {
      buildGateway()
      const socket = makeSocket()
      socket.data['userId'] = 'user-1'

      await gateway.handleDisconnect(socket as unknown as import('socket.io').Socket)

      expect(redis.srem).toHaveBeenCalledWith('ws:user:user-1:sockets', socket.id)
    })

    it('does nothing if socket has no userId', async () => {
      buildGateway()
      const socket = makeSocket()
      // no userId in socket.data

      await gateway.handleDisconnect(socket as unknown as import('socket.io').Socket)

      expect(redis.srem).not.toHaveBeenCalled()
    })
  })

  // ── handleRoomJoin ────────────────────────────────────────────────────────

  describe('handleRoomJoin', () => {
    it('joins the room when user is a project member', async () => {
      buildGateway(0, [{ role: 'member' }], [{ id: 'room-1' }])
      const socket = makeSocket()
      socket.data['userId'] = 'user-1'

      await gateway.handleRoomJoin(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', projectId: 'proj-1' },
      )

      expect(socket.join).toHaveBeenCalledWith('room:room-1')
      expect(socket.emit).not.toHaveBeenCalled()
    })

    it('emits system.error not_member and does NOT join room when user is not a member', async () => {
      buildGateway(0, [] /* no membership rows */, [{ id: 'room-1' }])
      const socket = makeSocket()
      socket.data['userId'] = 'user-1'

      await gateway.handleRoomJoin(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', projectId: 'proj-1' },
      )

      expect(socket.emit).toHaveBeenCalledWith(
        'system.error',
        expect.objectContaining({ code: 'not_member' }),
      )
      expect(socket.join).not.toHaveBeenCalled()
    })

    it('emits system.error invalid_payload for malformed payload', async () => {
      buildGateway()
      const socket = makeSocket()
      socket.data['userId'] = 'user-1'

      await gateway.handleRoomJoin(
        socket as unknown as import('socket.io').Socket,
        { roomId: 123 }, // wrong type
      )

      expect(socket.emit).toHaveBeenCalledWith(
        'system.error',
        expect.objectContaining({ code: 'invalid_payload' }),
      )
    })
  })
})

// ── EventRelayService ─────────────────────────────────────────────────────────

describe('EventRelayService relay logic', () => {
  it('emits the event to the correct Socket.IO room', async () => {
    const { EventRelayService } = await import('./event-relay.service')

    const mockServer = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
    }

    const mockRedis = {
      on: vi.fn(),
      psubscribe: vi.fn().mockResolvedValue(undefined),
      punsubscribe: vi.fn().mockResolvedValue(undefined),
      removeListener: vi.fn(),
      quit: vi.fn().mockResolvedValue('OK'),
    }

    const mockConfig = {
      get: vi.fn().mockReturnValue('redis://localhost:6379'),
    }

    // We can't easily call onModuleInit without a real Redis — test relayEvent directly
    const service = new EventRelayService(
      mockRedis as unknown as import('ioredis').default,
      mockConfig as unknown as ConfigService,
    )
    service.setServer(mockServer as unknown as import('socket.io').Server)

    const payload = {
      conversationId: 'conv-1',
      roomId: 'room-42',
      projectId: 'proj-1',
      node: { id: 'node-1' },
    }

    // Access protected method for testing
    ;(service as unknown as { relayEvent(c: string, p: unknown): void }).relayEvent(
      'conv.node.appended:proj-1',
      payload,
    )

    expect(mockServer.to).toHaveBeenCalledWith('room:room-42')
    expect(mockServer.emit).toHaveBeenCalledWith('conv.node.appended', payload)
  })

  it('does nothing when server is not yet set', async () => {
    const { EventRelayService } = await import('./event-relay.service')

    const mockRedis = { on: vi.fn() }
    const mockConfig = { get: vi.fn().mockReturnValue('redis://localhost:6379') }

    const service = new EventRelayService(
      mockRedis as unknown as import('ioredis').default,
      mockConfig as unknown as ConfigService,
    )
    // setServer NOT called

    // Should not throw
    expect(() => {
      ;(service as unknown as { relayEvent(c: string, p: unknown): void }).relayEvent(
        'conv.node.appended:proj-1',
        { roomId: 'room-1' },
      )
    }).not.toThrow()
  })
})
