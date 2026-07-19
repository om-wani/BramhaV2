import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import { AppModule } from './app.module.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';
import { ProblemJsonExceptionFilter } from './common/filters/problem-json.filter.js';
import { migrate } from '@bramha/db';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  // Security headers via Fastify (HSTS, nosniff, X-Frame-Options DENY, referrer-policy)
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false, // CSP is handled by the web app's middleware
    crossOriginEmbedderPolicy: false,
  });

  // CORS: exact-origin allowlist from APP_ORIGIN env
  const allowedOrigin = process.env['APP_ORIGIN'] ?? 'http://localhost:3000';
  await app.register(fastifyCors, {
    origin: allowedOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Socket.IO (in-process, no Redis adapter)
  app.useWebSocketAdapter(new IoAdapter(app));

  // Global pipes + filters
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ProblemJsonExceptionFilter());

  // Run DB migrations before accepting requests
  await migrate();

  const port = parseInt(process.env['PORT_SERVER'] ?? '3001', 10);
  await app.listen(port, '0.0.0.0');
  console.log(`[server] listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error('[server] fatal error during bootstrap:', err);
  process.exit(1);
});
