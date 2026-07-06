import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { OrgMemberGuard } from '../common/guards/org-role.guard'
import { ProjectViewerGuard, ProjectOwnerGuard } from '../common/guards/project-member.guard'
import { ProjectsService } from './projects.service'
import { ProjectsController } from './projects.controller'

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, OrgMemberGuard, ProjectViewerGuard, ProjectOwnerGuard],
  exports: [ProjectsService],
})
export class ProjectsModule {}
