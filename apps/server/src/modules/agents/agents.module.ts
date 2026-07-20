import { Module, forwardRef } from '@nestjs/common';
import { AgentsService } from './agents.service.js';
import { ProactiveModule } from '../proactive/proactive.module.js';

@Module({
  imports: [forwardRef(() => ProactiveModule)],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
