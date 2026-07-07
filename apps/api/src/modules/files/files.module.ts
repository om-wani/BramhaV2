import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard'
import { FilesService } from './files.service'
import { FilesController } from './files.controller'

@Module({
  imports: [AuthModule],
  controllers: [FilesController],
  providers: [FilesService, ProjectViewerGuard, ProjectEditorGuard],
  exports: [FilesService],
})
export class FilesModule {}
