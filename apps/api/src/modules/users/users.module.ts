import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ApiKeysModule } from './api-keys/api-keys.module'
import { UsersService } from './users.service'
import { UsersController } from './users.controller'

@Module({
  imports: [AuthModule, ApiKeysModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
