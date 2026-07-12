import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { AdminService } from './admin.service.js'
import { AdminController } from './admin.controller.js'

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
