import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { OrgAdminGuard, OrgOwnerGuard, OrgMemberGuard } from '../common/guards/org-role.guard.js'
import { OrgsService } from './orgs.service.js'
import { OrgsController } from './orgs.controller.js'

@Module({
  imports: [AuthModule],
  controllers: [OrgsController],
  providers: [OrgsService, OrgAdminGuard, OrgOwnerGuard, OrgMemberGuard],
  exports: [OrgsService],
})
export class OrgsModule {}
