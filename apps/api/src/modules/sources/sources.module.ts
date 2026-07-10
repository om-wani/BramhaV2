import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard'
import { SourcesService } from './sources.service'
import { SourcesController } from './sources.controller'

@Module({
  imports: [AuthModule],
  controllers: [SourcesController],
  providers: [SourcesService, ProjectViewerGuard, ProjectEditorGuard],
  exports: [SourcesService],
})
export class SourcesModule {}
