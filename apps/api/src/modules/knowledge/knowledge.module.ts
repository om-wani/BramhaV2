import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ProjectViewerGuard } from '../common/guards/project-member.guard'
import { KnowledgeService } from './knowledge.service'
import { KnowledgeController } from './knowledge.controller'

@Module({
  imports: [AuthModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, ProjectViewerGuard],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
