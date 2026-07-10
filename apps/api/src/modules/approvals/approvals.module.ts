import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { RedisModule } from '../common/redis/redis.module'
import { ProjectViewerGuard } from '../common/guards/project-member.guard'
import { ApprovalsService } from './approvals.service'
import { ApprovalsController } from './approvals.controller'

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ProjectViewerGuard],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
