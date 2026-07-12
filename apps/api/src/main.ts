import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import { cleanupOpenApiDoc } from 'nestjs-zod'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { ZodValidationPipe } from 'nestjs-zod'
import { ProblemJsonFilter } from './common/filters/problem-json.filter'
import { createLogger } from './common/logger'
import { Logger } from 'nestjs-pino'

async function bootstrap() {
  const logger = createLogger()

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, trustProxy: true }),
    { logger },
  )

  // Security headers
  // Cast required: @fastify/helmet and @fastify/cors have a fastify peer version mismatch
  // with @nestjs/platform-fastify. Runtime behavior is identical; types diverge superficially.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(helmet as any, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    xssFilter: true,
  })

  // CORS — strict allowlist from env
  const allowedOrigins = (process.env['ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  if (allowedOrigins.length === 0 && process.env['NODE_ENV'] === 'production') {
    logger.warn('ALLOWED_ORIGINS is empty — all cross-origin requests will be denied')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(cors as any, {
    origin: (origin: string | undefined, callback: (err: Error | null, allow: boolean) => void) => {
      if (!origin) {
        // Non-browser requests (server-to-server, health checks)
        callback(null, false)
        return
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(null, false)
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })

  // Global pipes and filters
  app.useGlobalPipes(new ZodValidationPipe())
  app.useGlobalFilters(new ProblemJsonFilter())

  // OpenAPI — disabled in production
  if (process.env['NODE_ENV'] !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('BramhaV2 API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build()
    const doc = SwaggerModule.createDocument(app, config)
    const cleanedDoc = cleanupOpenApiDoc(doc)
    SwaggerModule.setup('docs', app, cleanedDoc)
  }

  app.useLogger(app.get(Logger))

  const port = parseInt(process.env['PORT'] ?? '3001', 10)
  const host = process.env['HOST'] ?? '0.0.0.0'

  await app.listen(port, host)
  logger.log(`API listening on ${host}:${port}`)
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
