import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { LoggerModule } from 'nestjs-pino'
import { HealthModule } from './modules/health/health.module'
import { AuthModule } from './modules/auth/auth.module'
import { DbModule } from './modules/common/db/db.module'
import { RedisModule } from './modules/common/redis/redis.module'
import { UsersModule } from './modules/users/users.module'
import { OrgsModule } from './modules/orgs/orgs.module'
import { ProjectsModule } from './modules/projects/projects.module'
import { RoomsModule } from './modules/rooms/rooms.module'
import { ConversationsModule } from './modules/conversations/conversations.module'
import { RealtimeModule } from './modules/realtime/realtime.module'

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
    AuthModule,
    DbModule,
    RedisModule,
    UsersModule,
    OrgsModule,
    ProjectsModule,
    RoomsModule,
    ConversationsModule,
    RealtimeModule,
  ],
})
export class AppModule {}
