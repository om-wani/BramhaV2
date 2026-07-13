import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { LoggerModule } from 'nestjs-pino'
import { HealthModule } from './modules/health/health.module.js'
import { AuthModule } from './modules/auth/auth.module.js'
import { DbModule } from './modules/common/db/db.module.js'
import { RedisModule } from './modules/common/redis/redis.module.js'
import { UsersModule } from './modules/users/users.module.js'
import { OrgsModule } from './modules/orgs/orgs.module.js'
import { ProjectsModule } from './modules/projects/projects.module.js'
import { RoomsModule } from './modules/rooms/rooms.module.js'
import { ConversationsModule } from './modules/conversations/conversations.module.js'
import { RealtimeModule } from './modules/realtime/realtime.module.js'
import { ArtifactsModule } from './modules/artifacts/artifacts.module.js'
import { FilesModule } from './modules/files/files.module.js'
import { KnowledgeModule } from './modules/knowledge/knowledge.module.js'
import { NotesModule } from './modules/notes/notes.module.js'
import { DelegationsModule } from './modules/delegations/delegations.module.js'
import { ApprovalsModule } from './modules/approvals/approvals.module.js'
import { SourcesModule } from './modules/sources/sources.module.js'
import { AdminModule } from './modules/admin/admin.module.js'

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
        // pino-pretty is a devDependency (absent from the production image via
        // `pnpm deploy --prod`) — gate on the exact dev value, not "not prod",
        // so any other/unset NODE_ENV falls through to safe structured JSON.
        ...(process.env['NODE_ENV'] === 'development'
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
    ArtifactsModule,
    FilesModule,
    KnowledgeModule,
    NotesModule,
    DelegationsModule,
    ApprovalsModule,
    SourcesModule,
    AdminModule,
  ],
})
export class AppModule {}
