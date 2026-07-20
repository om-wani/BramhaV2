import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { FilesService } from './files.service.js';
import { FilesController } from './files.controller.js';

@Module({
  imports: [AuthModule, ProjectsModule],
  providers: [FilesService],
  controllers: [FilesController],
  exports: [FilesService],
})
export class FilesModule {}
