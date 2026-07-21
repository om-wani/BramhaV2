import { Module, forwardRef } from '@nestjs/common';
import { AgentsService } from './agents.service.js';
import { DelegationsController } from './delegations.controller.js';
import { ProactiveModule } from '../proactive/proactive.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProjectsModule } from '../projects/projects.module.js';

@Module({
  imports: [forwardRef(() => ProactiveModule), AuthModule, ProjectsModule],
  providers: [AgentsService],
  controllers: [DelegationsController],
  exports: [AgentsService],
})
export class AgentsModule {}
