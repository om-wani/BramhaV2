import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { IncomingMessage } from 'http'
import { Redis } from 'ioredis'
import { EventSubscriber } from '@bramha/event-bus'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { RlsDbService } from '../common/db/rls-db.service.js'

@Controller('events')
export class SseController {
  private readonly logger = new Logger(SseController.name)

  constructor(
    private readonly db: RlsDbService,
    private readonly config: ConfigService,
  ) {}

  /**
   * SSE fallback for real-time conv.* events.
   *
   * GET /events/:roomId?projectId=<uuid>
   * Authorization: Bearer <token>
   * Last-Event-ID: <id>  (optional, on reconnect)
   *
   * Streams `event: <type>\ndata: <json>\n\n` messages.
   * Sends a heartbeat every 15 s.
   */
  @Get(':roomId')
  @UseGuards(JwtAuthGuard)
  async stream(
    @Param('roomId') roomId: string,
    @Query('projectId') projectId: string,
    @Req() req: FastifyRequest & { user: { userId: string }; raw: IncomingMessage },
    @Res() res: FastifyReply & { raw: import('http').ServerResponse },
  ): Promise<void> {
    const { userId } = req.user

    if (!projectId) {
      throw new ForbiddenException({ code: 'project_id_required' })
    }

    // ── Membership check ───────────────────────────────────────────────────
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
      throw new ForbiddenException({ code: 'forbidden' })
    }

    // ── Room existence check ───────────────────────────────────────────────
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
      throw new NotFoundException({ code: 'not_found' })
    }

    // ── SSE response headers ───────────────────────────────────────────────
    const raw = res.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    raw.write(':ok\n\n') // flush headers immediately

    // ── Last-Event-ID ──────────────────────────────────────────────────────
    // We don't store history, but we acknowledge the header so clients know
    // we received it. Future implementations can replay missed events.
    const lastEventId = req.headers['last-event-id'] as string | undefined
    if (lastEventId) {
      this.logger.log({ event: 'sse.reconnect', roomId, lastEventId })
    }

    // ── Redis subscriber (one per SSE connection) ──────────────────────────
    const redisUrl = this.config.get<string>('REDIS_URL', 'redis://localhost:6379')
    const subRedis = new Redis(redisUrl)
    const subscriber = new EventSubscriber(subRedis)

    const pattern = `conv.*:${projectId}`

    const write = (event: string, data: unknown): void => {
      try {
        raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      } catch {
        // client disconnected — cleanup will fire via req.raw 'close'
      }
    }

    await subscriber.subscribePattern(pattern, (channel, payload) => {
      const p = payload as Record<string, unknown>
      if (p['roomId'] !== roomId) return

      const colonIdx = channel.indexOf(':')
      const eventType = colonIdx !== -1 ? channel.slice(0, colonIdx) : channel

      write(eventType, payload)
    })

    // ── Heartbeat every 15 s ───────────────────────────────────────────────
    const heartbeatTimer = setInterval(() => {
      write('heartbeat', {})
    }, 15_000)

    // ── Cleanup on client disconnect ───────────────────────────────────────
    const cleanup = async (): Promise<void> => {
      clearInterval(heartbeatTimer)
      try {
        await subscriber.unsubscribePattern(pattern)
        subscriber.destroy()
        await subRedis.quit()
      } catch {
        // best-effort cleanup
      }
      this.logger.log({ event: 'sse.closed', roomId, userId })
    }

    req.raw.on('close', () => {
      void cleanup()
    })
    req.raw.on('error', () => {
      void cleanup()
    })
  }
}
