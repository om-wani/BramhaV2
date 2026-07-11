import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common'
import { SignJWT, jwtVerify, importPKCS8, importSPKI, type CryptoKey, type KeyObject } from 'jose'
import { ConfigService } from '@nestjs/config'
import { SESSION_ACCESS_TOKEN_TTL_SECONDS, PRE_AUTH_TOKEN_TTL_SECONDS } from '@bramha/shared'

const ISS = 'bramha'
const AUD = 'bramha-api'

type JoseKey = CryptoKey | KeyObject

@Injectable()
export class JwtService implements OnModuleInit {
  private privateKey!: JoseKey
  private publicKey!: JoseKey
  private keyId!: string

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const privateKeyB64 = this.config.getOrThrow<string>('JWT_PRIVATE_KEY_BASE64')
    const publicKeyB64 = this.config.getOrThrow<string>('JWT_PUBLIC_KEY_BASE64')
    this.keyId = this.config.get<string>('JWT_KEY_ID') ?? 'key-1'

    const privatePem = Buffer.from(privateKeyB64, 'base64').toString('utf-8')
    const publicPem = Buffer.from(publicKeyB64, 'base64').toString('utf-8')

    this.privateKey = await importPKCS8(privatePem, 'EdDSA')
    this.publicKey = await importSPKI(publicPem, 'EdDSA')
  }

  async sign(
    userId: string,
    options: { twoFactorVerified?: boolean } = {},
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const now = Math.floor(Date.now() / 1000)
    const claims: Record<string, unknown> = { sub: userId }
    if (options.twoFactorVerified) {
      claims['tfv'] = true
    }
    const accessToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'EdDSA', kid: this.keyId })
      .setIssuer(ISS)
      .setAudience(AUD)
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + SESSION_ACCESS_TOKEN_TTL_SECONDS)
      .sign(this.privateKey)
    return { accessToken, expiresIn: SESSION_ACCESS_TOKEN_TTL_SECONDS }
  }

  private rejectWeakAlg(token: string): void {
    const parts = token.split('.')
    if (parts.length >= 1 && parts[0]) {
      try {
        const headerJson = Buffer.from(parts[0], 'base64url').toString('utf-8')
        const header = JSON.parse(headerJson) as Record<string, unknown>
        const alg = header['alg']
        if (!alg || alg === 'none' || alg === 'HS256' || alg === 'HS384' || alg === 'HS512') {
          throw new UnauthorizedException({
            code: 'invalid_token',
            message: 'Invalid token algorithm',
          })
        }
      } catch (e) {
        if (e instanceof UnauthorizedException) throw e
        // Malformed base64url — let jwtVerify reject it below
      }
    }
  }

  async verify(token: string): Promise<{ userId: string; twoFactorVerified: boolean }> {
    // Reject alg:none and HS256 downgrade by inspecting the header before full verification
    this.rejectWeakAlg(token)

    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ['EdDSA'],
        issuer: ISS,
        audience: AUD,
      })
      if (!payload.sub) {
        throw new UnauthorizedException({ code: 'invalid_token', message: 'Missing subject claim' })
      }
      return {
        userId: payload.sub,
        twoFactorVerified: (payload as Record<string, unknown>)['tfv'] === true,
      }
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e
      throw new UnauthorizedException({ code: 'invalid_token', message: 'Invalid token' })
    }
  }

  async signPreAuth(userId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    return new SignJWT({ sub: userId, type: 'pre_auth' })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.keyId })
      .setIssuer(ISS)
      .setAudience(AUD)
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + PRE_AUTH_TOKEN_TTL_SECONDS)
      .sign(this.privateKey)
  }

  async verifyPreAuth(token: string): Promise<{ userId: string }> {
    this.rejectWeakAlg(token)

    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ['EdDSA'],
        issuer: ISS,
        audience: AUD,
      })
      if (!payload.sub) {
        throw new UnauthorizedException({
          code: 'pre_auth_token_invalid',
          message: 'Invalid pre-auth token',
        })
      }
      if ((payload as Record<string, unknown>)['type'] !== 'pre_auth') {
        throw new UnauthorizedException({
          code: 'pre_auth_token_invalid',
          message: 'Token is not a pre-auth token',
        })
      }
      return { userId: payload.sub }
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e
      throw new UnauthorizedException({
        code: 'pre_auth_token_invalid',
        message: 'Invalid pre-auth token',
      })
    }
  }

  async signPendingTotp(userId: string, secret: string): Promise<string> {
    return new SignJWT({ type: 'pending_totp', secret })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.keyId })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('10m')
      .setIssuer(ISS)
      .setAudience(AUD)
      .sign(this.privateKey)
  }

  async verifyPendingTotp(token: string, userId: string): Promise<{ secret: string }> {
    this.rejectWeakAlg(token)

    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ['EdDSA'],
        issuer: ISS,
        audience: AUD,
      })
      if ((payload as Record<string, unknown>)['type'] !== 'pending_totp') {
        throw new UnauthorizedException({
          code: 'invalid_token',
          message: 'Not a pending TOTP token',
        })
      }
      if (payload.sub !== userId) {
        throw new UnauthorizedException({
          code: 'invalid_token',
          message: 'User mismatch in pending TOTP token',
        })
      }
      const secret = (payload as Record<string, unknown>)['secret']
      if (typeof secret !== 'string') {
        throw new UnauthorizedException({
          code: 'invalid_token',
          message: 'Missing secret claim in pending TOTP token',
        })
      }
      return { secret }
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e
      throw new UnauthorizedException({
        code: 'invalid_token',
        message: 'Invalid pending TOTP token',
      })
    }
  }
}
