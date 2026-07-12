import { Module, forwardRef } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module.js'
import { ApiKeysController } from './api-keys.controller.js'
import { ApiKeysService } from './api-keys.service.js'
import { ApiKeyGuard } from './guards/api-key.guard.js'

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyGuard],
  exports: [ApiKeysService, ApiKeyGuard],
})
export class ApiKeysModule {}
