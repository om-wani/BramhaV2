import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard'
import { NotesService } from './notes.service'
import { NotesController } from './notes.controller'

@Module({
  imports: [AuthModule],
  controllers: [NotesController],
  providers: [NotesService, ProjectViewerGuard, ProjectEditorGuard],
  exports: [NotesService],
})
export class NotesModule {}
