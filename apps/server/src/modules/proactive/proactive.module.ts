import { Module, forwardRef } from '@nestjs/common';
import { ProactiveService } from './proactive.service.js';
import { AgentsModule } from '../agents/agents.module.js';

@Module({
  imports: [forwardRef(() => AgentsModule)],
  providers: [ProactiveService],
  exports: [ProactiveService],
})
export class ProactiveModule {}
