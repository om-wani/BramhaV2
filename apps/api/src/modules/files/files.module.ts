import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard.js'
import { FilesService } from './files.service.js'
import { FilesController } from './files.controller.js'

@Module({
  imports: [AuthModule],
  controllers: [FilesController],
  providers: [FilesService, ProjectViewerGuard, ProjectEditorGuard],
  exports: [FilesService],
})
export class FilesModule {}
