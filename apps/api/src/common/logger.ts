import { Logger } from '@nestjs/common'
import pino from 'pino'

export function createLogger() {
  return new Logger('Bootstrap')
}

// Pino logger instance for use in non-DI contexts
export const pinoLogger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.password_hash',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
})
