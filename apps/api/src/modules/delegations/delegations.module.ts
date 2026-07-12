import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { RedisModule } from '../common/redis/redis.module.js'
import { ProjectViewerGuard } from '../common/guards/project-member.guard.js'
import { DelegationsService } from './delegations.service.js'
import { DelegationsController } from './delegations.controller.js'

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [DelegationsController],
  providers: [DelegationsService, ProjectViewerGuard],
  exports: [DelegationsService],
})
export class DelegationsModule {}
