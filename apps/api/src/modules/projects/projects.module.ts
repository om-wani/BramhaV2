import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { OrgMemberGuard } from '../common/guards/org-role.guard.js'
import { ProjectViewerGuard, ProjectOwnerGuard } from '../common/guards/project-member.guard.js'
import { ProjectsService } from './projects.service.js'
import { ProjectsController } from './projects.controller.js'

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, OrgMemberGuard, ProjectViewerGuard, ProjectOwnerGuard],
  exports: [ProjectsService],
})
export class ProjectsModule {}
