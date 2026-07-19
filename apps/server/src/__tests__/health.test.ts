import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { HealthModule } from '../modules/health/health.module.js';
import { ProblemJsonExceptionFilter } from '../common/filters/problem-json.filter.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { HttpException, HttpStatus, Controller, Get } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Health endpoint tests
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new ProblemJsonExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with { status: ok }', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; timestamp: string }>();
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
    // ISO timestamp format check
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});

// ---------------------------------------------------------------------------
// ProblemJsonExceptionFilter tests
// ---------------------------------------------------------------------------

@Controller('__test__')
class TestErrorController {
  @Get('http-error')
  throwHttp() {
    throw new HttpException({ title: 'Test Error', code: 'TEST_ERROR' }, HttpStatus.BAD_REQUEST);
  }

  @Get('http-error-string')
  throwHttpString() {
    throw new HttpException('Something went wrong', HttpStatus.UNPROCESSABLE_ENTITY);
  }

  @Get('unknown-error')
  throwUnknown() {
    throw new Error('boom');
  }
}

describe('ProblemJsonExceptionFilter', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TestErrorController],
    }).compile();

    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalFilters(new ProblemJsonExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns RFC 7807 shape with Content-Type: application/problem+json for HttpException (object)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/__test__/http-error',
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');

    const body = response.json<Record<string, unknown>>();
    expect(body['type']).toBe('about:blank');
    expect(body['status']).toBe(400);
    expect(body['title']).toBe('Test Error');
    expect(body['code']).toBe('TEST_ERROR');
  });

  it('returns RFC 7807 shape for HttpException (string message)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/__test__/http-error-string',
    });

    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toContain('application/problem+json');

    const body = response.json<Record<string, unknown>>();
    expect(body['type']).toBe('about:blank');
    expect(body['status']).toBe(422);
    expect(typeof body['title']).toBe('string');
  });

  it('returns 500 with INTERNAL_ERROR code for unknown errors (no details leaked)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/__test__/unknown-error',
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toContain('application/problem+json');

    const body = response.json<Record<string, unknown>>();
    expect(body['type']).toBe('about:blank');
    expect(body['status']).toBe(500);
    expect(body['code']).toBe('INTERNAL_ERROR');
    // Must not leak internal error message
    expect(JSON.stringify(body)).not.toContain('boom');
  });
});
