import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { RealtimeModule } from '../realtime/realtime.module'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard'
import { RoomsService } from './rooms.service'
import { RoomsController } from './rooms.controller'
import { ProjectAgentsController, TokenUsageController } from './project-agents.controller'

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [RoomsController, ProjectAgentsController, TokenUsageController],
  providers: [RoomsService, ProjectViewerGuard, ProjectEditorGuard],
  exports: [RoomsService],
})
export class RoomsModule {}
