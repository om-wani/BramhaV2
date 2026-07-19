import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { AgentsModule } from '../agents/agents.module.js';
import { ConversationService } from './conversation.service.js';
import { ConversationController } from './conversation.controller.js';

@Module({
  imports: [AuthModule, ProjectsModule, RoomsModule, AgentsModule],
  providers: [ConversationService],
  controllers: [ConversationController],
  exports: [ConversationService],
})
export class ConversationModule {}
