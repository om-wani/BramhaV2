import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

@Catch()
export class ProblemJsonExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown>;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null) {
        body = { type: 'about:blank', status, ...res as Record<string, unknown> };
      } else {
        body = { type: 'about:blank', title: String(res), status };
      }
    } else {
      // Internal errors: no details leaked in production
      body = {
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        code: 'INTERNAL_ERROR',
      };
    }

    void reply
      .status(status)
      .header('Content-Type', 'application/problem+json')
      .send(body);
  }
}
