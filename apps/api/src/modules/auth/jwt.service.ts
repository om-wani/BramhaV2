import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common'
import { SignJWT, jwtVerify, importPKCS8, importSPKI, type CryptoKey, type KeyObject } from 'jose'
import { ConfigService } from '@nestjs/config'
import { SESSION_ACCESS_TOKEN_TTL_SECONDS } from '@bramha/shared'

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

  async sign(userId: string): Promise<{ accessToken: string; expiresIn: number }> {
    const now = Math.floor(Date.now() / 1000)
    const accessToken = await new SignJWT({ sub: userId })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.keyId })
      .setIssuer(ISS)
      .setAudience(AUD)
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + SESSION_ACCESS_TOKEN_TTL_SECONDS)
      .sign(this.privateKey)
    return { accessToken, expiresIn: SESSION_ACCESS_TOKEN_TTL_SECONDS }
  }

  async verify(token: string): Promise<{ userId: string }> {
    // Reject alg:none and HS256 downgrade by inspecting the header before full verification
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

    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ['EdDSA'],
        issuer: ISS,
        audience: AUD,
      })
      if (!payload.sub) {
        throw new UnauthorizedException({ code: 'invalid_token', message: 'Missing subject claim' })
      }
      return { userId: payload.sub }
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e
      throw new UnauthorizedException({ code: 'invalid_token', message: 'Invalid token' })
    }
  }
}
