import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { AppModule } from './app.module'
import { ZodValidationPipe } from 'nestjs-zod'
import { ProblemJsonFilter } from './common/filters/problem-json.filter'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'

let app: NestFastifyApplication

beforeAll(async () => {
  process.env['ALLOWED_ORIGINS'] = 'http://localhost:3000'
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(helmet as any, {
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(cors as any, {
    origin: ['http://localhost:3000'],
    credentials: true,
  })

  app.useGlobalPipes(new ZodValidationPipe())
  app.useGlobalFilters(new ProblemJsonFilter())

  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  await app.close()
})

describe('Security headers', () => {
  it('sets HSTS header', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' })
    expect(res.headers['strict-transport-security']).toMatch(/max-age=/)
  })

  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('sets X-Frame-Options: DENY', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' })
    expect(res.headers['x-frame-options']).toBe('DENY')
  })

  it('sets Referrer-Policy', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' })
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })
})

describe('CORS', () => {
  it('allows requests from allowed origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: 'http://localhost:3000' },
    })
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000')
  })

  it('does NOT set ACAO for disallowed origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: 'http://evil.example.com' },
    })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('Error handling', () => {
  it('returns problem+json for 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/not-found' })
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['code']).toBe('not_found')
    expect(body).not.toHaveProperty('stack')
  })
})

describe('Health endpoints', () => {
  it('GET /health/live returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' })
    expect(res.statusCode).toBe(200)
  })
})
