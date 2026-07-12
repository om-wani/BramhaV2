import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ProjectViewerGuard } from '../common/guards/project-member.guard.js'
import { KnowledgeService } from './knowledge.service.js'
import { KnowledgeController } from './knowledge.controller.js'

@Module({
  imports: [AuthModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, ProjectViewerGuard],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
