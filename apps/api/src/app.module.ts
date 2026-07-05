import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { LoggerModule } from 'nestjs-pino'
import { HealthModule } from './modules/health/health.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
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
        ...(process.env['NODE_ENV'] !== 'production'
          ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
          : {}),
      },
    }),
    HealthModule,
  ],
})
export class AppModule {}
