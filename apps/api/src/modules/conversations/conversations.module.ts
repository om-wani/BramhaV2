import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard'
import { ConversationsService } from './conversations.service'
import { ConversationsController } from './conversations.controller'

@Module({
  imports: [AuthModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ProjectViewerGuard, ProjectEditorGuard],
  exports: [ConversationsService],
})
export class ConversationsModule {}
