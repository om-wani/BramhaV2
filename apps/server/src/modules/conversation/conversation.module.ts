import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ConversationService } from './conversation.service.js';
import { ConversationController } from './conversation.controller.js';

@Module({
  imports: [AuthModule, ProjectsModule],
  providers: [ConversationService],
  controllers: [ConversationController],
  exports: [ConversationService],
})
export class ConversationModule {}
