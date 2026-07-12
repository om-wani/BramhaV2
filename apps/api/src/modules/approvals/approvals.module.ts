import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { RedisModule } from '../common/redis/redis.module.js'
import { ProjectViewerGuard } from '../common/guards/project-member.guard.js'
import { ApprovalsService } from './approvals.service.js'
import { ApprovalsController } from './approvals.controller.js'

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ProjectViewerGuard],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
