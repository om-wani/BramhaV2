import { Module, forwardRef } from '@nestjs/common'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { AuthDbService } from './auth-db.service.js'
import { JwtService } from './jwt.service.js'
import { PasswordService } from './password.service.js'
import { SessionService } from './session.service.js'
import { JwtAuthGuard } from './guards/jwt-auth.guard.js'
import { AnyAuthGuard } from './guards/any-auth.guard.js'
import { TotpService } from './totp.service.js'
import { TwoFactorService } from './twofactor.service.js'
import { TwoFactorController } from './twofactor.controller.js'
import { ApiKeysModule } from '../users/api-keys/api-keys.module.js'

@Module({
  imports: [forwardRef(() => ApiKeysModule)],
  controllers: [AuthController, TwoFactorController],
  providers: [
    AuthService,
    AuthDbService,
    JwtService,
    PasswordService,
    SessionService,
    JwtAuthGuard,
    AnyAuthGuard,
    TotpService,
    TwoFactorService,
  ],
  exports: [JwtService, JwtAuthGuard, AuthDbService, AnyAuthGuard],
})
export class AuthModule {}
