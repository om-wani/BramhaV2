import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ApiKeysModule } from './api-keys/api-keys.module.js'
import { UsersService } from './users.service.js'
import { UsersController } from './users.controller.js'

@Module({
  imports: [AuthModule, ApiKeysModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
