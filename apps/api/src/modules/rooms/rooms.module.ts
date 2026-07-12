import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { RealtimeModule } from '../realtime/realtime.module.js'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard.js'
import { RoomsService } from './rooms.service.js'
import { RoomsController } from './rooms.controller.js'
import { ProjectAgentsController, TokenUsageController } from './project-agents.controller.js'

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [RoomsController, ProjectAgentsController, TokenUsageController],
  providers: [RoomsService, ProjectViewerGuard, ProjectEditorGuard],
  exports: [RoomsService],
})
export class RoomsModule {}
