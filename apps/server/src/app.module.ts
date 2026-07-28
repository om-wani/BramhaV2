import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { OrgsModule } from './modules/orgs/orgs.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { RoomsModule } from './modules/rooms/rooms.module.js';
import { ConversationModule } from './modules/conversation/conversation.module.js';
import { GatewayModule } from './gateway/gateway.module.js';
import { AgentsModule } from './modules/agents/agents.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { IngestionModule } from './modules/ingestion/ingestion.module.js';
import { ProactiveModule } from './modules/proactive/proactive.module.js';
import { UsageModule } from './modules/usage/usage.module.js';
import { FeedbackModule } from './modules/feedback/feedback.module.js';
import { AdminModule } from './modules/admin/admin.module.js';

@Module({ imports: [HealthModule, AuthModule, OrgsModule, ProjectsModule, RoomsModule, ConversationModule, GatewayModule, AgentsModule, FilesModule, IngestionModule, ProactiveModule, UsageModule, FeedbackModule, AdminModule] })
export class AppModule {}
