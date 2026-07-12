import { Controller, Get } from '@nestjs/common'
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
} from '@nestjs/terminus'
import postgres from 'postgres'
import { Redis } from 'ioredis'

@Controller('health')
export class HealthController {
  constructor(private health: HealthCheckService) {}

  @Get('live')
  liveness() {
    return { status: 'ok' }
  }

  @Get('ready')
  @HealthCheck()
  async readiness() {
    return this.health.check([
      async (): Promise<HealthIndicatorResult> => {
        const start = Date.now()
        const dbUrl = process.env['DATABASE_URL']
        if (!dbUrl) return { postgres: { status: 'down', latencyMs: Date.now() - start } }
        const sql = postgres(dbUrl, { max: 1, connect_timeout: 5 })
        try {
          await sql`SELECT 1`
          return { postgres: { status: 'up', latencyMs: Date.now() - start } }
        } catch {
          return { postgres: { status: 'down', latencyMs: Date.now() - start } }
        } finally {
          await sql.end({ timeout: 2 })
        }
      },
      async (): Promise<HealthIndicatorResult> => {
        const start = Date.now()
        const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
        const redis = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 5000 })
        try {
          await redis.connect()
          await redis.ping()
          return { redis: { status: 'up', latencyMs: Date.now() - start } }
        } catch {
          return { redis: { status: 'down', latencyMs: Date.now() - start } }
        } finally {
          try { await redis.quit() } catch { /* ignore quit errors */ }
        }
      },
    ])
  }
}
