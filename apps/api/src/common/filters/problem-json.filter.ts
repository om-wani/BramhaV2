import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { FastifyReply } from 'fastify'
import { ZodValidationException } from 'nestjs-zod'

interface ProblemJson {
  status: number
  code: string
  title: string
  detail?: string
  errors?: unknown
}

@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemJsonFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const reply = ctx.getResponse<FastifyReply>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let code = 'internal_error'
    let title = 'An unexpected error occurred'
    let detail: string | undefined
    let errors: unknown

    if (exception instanceof ZodValidationException) {
      status = HttpStatus.UNPROCESSABLE_ENTITY
      code = 'validation_error'
      title = 'Validation failed'
      const zodError = exception.getZodError() as { errors?: unknown }
      errors = zodError.errors
    } else if (exception instanceof HttpException) {
      status = exception.getStatus()
      const response = exception.getResponse()
      if (typeof response === 'object' && response !== null) {
        const r = response as Record<string, unknown>
        code = typeof r['code'] === 'string' ? r['code'] : httpStatusToCode(status)
        title = typeof r['message'] === 'string' ? r['message'] : title
        detail = typeof r['detail'] === 'string' ? r['detail'] : undefined
      } else if (typeof response === 'string') {
        code = httpStatusToCode(status)
        title = response
      }
    } else if (exception instanceof Error) {
      // Log unexpected errors server-side but don't leak details
      this.logger.error({ err: exception }, 'Unhandled exception')
    }

    const body: ProblemJson = { status, code, title }
    if (detail) body.detail = detail
    if (errors) body.errors = errors

    void reply
      .status(status)
      .header('Content-Type', 'application/problem+json')
      .send(body)
  }
}

function httpStatusToCode(status: number): string {
  const map: Record<number, string> = {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    422: 'validation_error',
    429: 'rate_limited',
    500: 'internal_error',
    503: 'service_unavailable',
  }
  return map[status] ?? 'internal_error'
}
