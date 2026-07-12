import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard.js'
import { SourcesService } from './sources.service.js'
import { SourcesController } from './sources.controller.js'

@Module({
  imports: [AuthModule],
  controllers: [SourcesController],
  providers: [SourcesService, ProjectViewerGuard, ProjectEditorGuard],
  exports: [SourcesService],
})
export class SourcesModule {}
