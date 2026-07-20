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

@Module({ imports: [HealthModule, AuthModule, OrgsModule, ProjectsModule, RoomsModule, ConversationModule, GatewayModule, AgentsModule, FilesModule] })
export class AppModule {}
