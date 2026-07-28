import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FeedbackModule } from '../feedback/feedback.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [AuthModule, FeedbackModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
