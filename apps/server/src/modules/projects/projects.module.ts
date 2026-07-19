import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProjectsService } from './projects.service.js';
import { ProjectsController, OrgProjectsController } from './projects.controller.js';

@Module({
  imports: [AuthModule],
  providers: [ProjectsService],
  controllers: [ProjectsController, OrgProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
