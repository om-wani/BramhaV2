import { describe, it, expect, beforeAll } from 'vitest'
import { UnauthorizedException } from '@nestjs/common'
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'
import { ConfigService } from '@nestjs/config'
import { JwtService } from './jwt.service'

let svc: JwtService

beforeAll(async () => {
  // Generate a real Ed25519 keypair for tests
  const { privateKey, publicKey } = await generateKeyPair('Ed25519', { extractable: true })
  const privatePem = await exportPKCS8(privateKey)
  const publicPem = await exportSPKI(publicKey)

  const privateB64 = Buffer.from(privatePem).toString('base64')
  const publicB64 = Buffer.from(publicPem).toString('base64')

  const configService = {
    getOrThrow: (key: string) => {
      if (key === 'JWT_PRIVATE_KEY_BASE64') return privateB64
      if (key === 'JWT_PUBLIC_KEY_BASE64') return publicB64
      throw new Error(`Unknown config key: ${key}`)
    },
    get: (key: string, defaultVal?: string) => {
      if (key === 'JWT_KEY_ID') return 'test-key-1'
      return defaultVal
    },
  } as unknown as ConfigService

  svc = new JwtService(configService)
  await svc.onModuleInit()
})

describe('JwtService', () => {
  it('signs a token and verifies it, returning userId', async () => {
    const userId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    const { accessToken, expiresIn } = await svc.sign(userId)
    expect(typeof accessToken).toBe('string')
    expect(expiresIn).toBe(900)
    const result = await svc.verify(accessToken)
    expect(result.userId).toBe(userId)
  })

  it('rejects a tampered token (corrupt signature)', async () => {
    const { accessToken } = await svc.sign('user-id')
    const parts = accessToken.split('.')
    parts[2] = parts[2]!.slice(0, -2) + 'XX'
    const tampered = parts.join('.')
    await expect(svc.verify(tampered)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects alg:none token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({ sub: 'user', iss: 'bramha', aud: 'bramha-api' }),
    ).toString('base64url')
    const noneToken = `${header}.${payload}.`
    await expect(svc.verify(noneToken)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects HS256 downgrade token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ sub: 'user' })).toString('base64url')
    const token = `${header}.${payload}.fakesig`
    await expect(svc.verify(token)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects a completely invalid token string', async () => {
    await expect(svc.verify('not.a.jwt')).rejects.toThrow(UnauthorizedException)
  })

  it('happy path: verify returns correct userId', async () => {
    const { accessToken } = await svc.sign('some-user-id')
    const result = await svc.verify(accessToken)
    expect(result.userId).toBe('some-user-id')
  })
})
