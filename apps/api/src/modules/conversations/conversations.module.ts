import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard.js'
import { ConversationsService } from './conversations.service.js'
import { ConversationsController } from './conversations.controller.js'

@Module({
  imports: [AuthModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ProjectViewerGuard, ProjectEditorGuard],
  exports: [ConversationsService],
})
export class ConversationsModule {}
