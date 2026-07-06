import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard'
import { RoomsService } from './rooms.service'
import { RoomsController } from './rooms.controller'

@Module({
  imports: [AuthModule],
  controllers: [RoomsController],
  providers: [RoomsService, ProjectViewerGuard, ProjectEditorGuard],
  exports: [RoomsService],
})
export class RoomsModule {}
