import { Logger } from '@nestjs/common'

// Application logging is handled by nestjs-pino (LoggerModule in AppModule).
// Use @nestjs/common Logger for DI-based logging in services/controllers.
// pinoLogger is removed — all logging goes through nestjs-pino.

export function createLogger() {
  return new Logger('Bootstrap')
}
