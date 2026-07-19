import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { RoomsService } from './rooms.service.js';
import { RoomsController } from './rooms.controller.js';

@Module({
  imports: [AuthModule, ProjectsModule],
  providers: [RoomsService],
  controllers: [RoomsController],
  exports: [RoomsService],
})
export class RoomsModule {}
