import { Module, forwardRef } from '@nestjs/common'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AuthDbService } from './auth-db.service'
import { JwtService } from './jwt.service'
import { PasswordService } from './password.service'
import { SessionService } from './session.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { AnyAuthGuard } from './guards/any-auth.guard'
import { TotpService } from './totp.service'
import { TwoFactorService } from './twofactor.service'
import { TwoFactorController } from './twofactor.controller'
import { ApiKeysModule } from '../users/api-keys/api-keys.module'

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
