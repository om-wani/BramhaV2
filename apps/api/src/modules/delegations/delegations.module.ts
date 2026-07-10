import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { RedisModule } from '../common/redis/redis.module'
import { ProjectViewerGuard } from '../common/guards/project-member.guard'
import { DelegationsService } from './delegations.service'
import { DelegationsController } from './delegations.controller'

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [DelegationsController],
  providers: [DelegationsService, ProjectViewerGuard],
  exports: [DelegationsService],
})
export class DelegationsModule {}
