import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AuthDbService } from './auth-db.service'
import { JwtService } from './jwt.service'
import { PasswordService } from './password.service'
import { SessionService } from './session.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthDbService,
    JwtService,
    PasswordService,
    SessionService,
    JwtAuthGuard,
  ],
  exports: [JwtService, JwtAuthGuard],
})
export class AuthModule {}
