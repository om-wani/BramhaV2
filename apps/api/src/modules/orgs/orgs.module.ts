import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { OrgAdminGuard, OrgOwnerGuard, OrgMemberGuard } from '../common/guards/org-role.guard'
import { OrgsService } from './orgs.service'
import { OrgsController } from './orgs.controller'

@Module({
  imports: [AuthModule],
  controllers: [OrgsController],
  providers: [OrgsService, OrgAdminGuard, OrgOwnerGuard, OrgMemberGuard],
  exports: [OrgsService],
})
export class OrgsModule {}
