import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AuthDbService } from './auth-db.service'
import { JwtService } from './jwt.service'
import { PasswordService } from './password.service'
import { SessionService } from './session.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { TotpService } from './totp.service'
import { TwoFactorService } from './twofactor.service'
import { TwoFactorController } from './twofactor.controller'

@Module({
  controllers: [AuthController, TwoFactorController],
  providers: [
    AuthService,
    AuthDbService,
    JwtService,
    PasswordService,
    SessionService,
    JwtAuthGuard,
    TotpService,
    TwoFactorService,
  ],
  exports: [JwtService, JwtAuthGuard, AuthDbService],
})
export class AuthModule {}
