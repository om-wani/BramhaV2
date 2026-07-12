import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard.js'
import { NotesService } from './notes.service.js'
import { NotesController } from './notes.controller.js'

@Module({
  imports: [AuthModule],
  controllers: [NotesController],
  providers: [NotesService, ProjectViewerGuard, ProjectEditorGuard],
  exports: [NotesService],
})
export class NotesModule {}
