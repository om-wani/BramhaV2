import { Controller, Get } from '@nestjs/common'
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
} from '@nestjs/terminus'
import postgres from 'postgres'
import Redis from 'ioredis'

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
        try {
          const dbUrl = process.env['DATABASE_URL']
          if (!dbUrl) throw new Error('DATABASE_URL not set')
          const sql = postgres(dbUrl, { max: 1, connect_timeout: 5 })
          await sql`SELECT 1`
          await sql.end()
          return { postgres: { status: 'up', latencyMs: Date.now() - start } }
        } catch {
          return { postgres: { status: 'down', latencyMs: Date.now() - start } }
        }
      },
      async (): Promise<HealthIndicatorResult> => {
        const start = Date.now()
        try {
          const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
          const redis = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 5000 })
          await redis.connect()
          await redis.ping()
          await redis.quit()
          return { redis: { status: 'up', latencyMs: Date.now() - start } }
        } catch {
          return { redis: { status: 'down', latencyMs: Date.now() - start } }
        }
      },
    ])
  }
}
