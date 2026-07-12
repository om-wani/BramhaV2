import { Injectable, Logger } from '@nestjs/common'
import type { Socket } from 'socket.io'
import { JwtService } from '../auth/jwt.service.js'

export const WS_SOCKET_CAP = 5

/**
 * Handles JWT verification on WebSocket handshake.
 * Called in the gateway's handleConnection lifecycle hook (not as a NestJS HTTP guard).
 *
 * On success: sets socket.data.userId and returns true.
 * On failure: emits auth_expired / auth_error and disconnects the socket, returns false.
 */
@Injectable()
export class WsAuthGuard {
  private readonly logger = new Logger(WsAuthGuard.name)

  constructor(private readonly jwtService: JwtService) {}

  async verifyHandshake(client: Socket): Promise<string | null> {
    const token = client.handshake.auth?.['token'] as string | undefined

    if (!token) {
      this.logger.warn({ event: 'ws.auth.missing_token', socketId: client.id })
      client.emit('auth_expired', { code: 'auth_expired', message: 'Missing token' })
      client.disconnect(true)
      return null
    }

    try {
      const { userId } = await this.jwtService.verify(token)
      return userId
    } catch {
      this.logger.warn({ event: 'ws.auth.token_failed', socketId: client.id })
      client.emit('auth_expired', { code: 'auth_expired', message: 'Token expired or invalid' })
      client.disconnect(true)
      return null
    }
  }
}
