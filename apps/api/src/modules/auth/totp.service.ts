import { Injectable, OnModuleInit, Logger } from '@nestjs/common'
import { generateSecret, generateURI, verifySync } from 'otplib'
import { createCipheriv, createDecipheriv, randomBytes, createSecretKey } from 'crypto'
import { TOTP_WINDOW } from '@bramha/shared'

// TOTP period in seconds (standard is 30s)
const TOTP_PERIOD = 30

@Injectable()
export class TotpService implements OnModuleInit {
  private readonly logger = new Logger(TotpService.name)
  private masterKey!: Buffer

  onModuleInit(): void {
    const masterKeyB64 = process.env['MASTER_KEY']
    if (!masterKeyB64) throw new Error('MASTER_KEY environment variable is required')
    this.masterKey = Buffer.from(masterKeyB64, 'base64')
    if (this.masterKey.length !== 32) {
      throw new Error(`MASTER_KEY must be exactly 32 bytes (got ${this.masterKey.length})`)
    }
    this.logger.log('TotpService initialized with master key')
  }

  // ── Secret generation ───────────────────────────────────────────────────────

  generateSecret(): string {
    // 20 bytes of entropy → 32-char base32 string (160 bits)
    return generateSecret({ length: 20 })
  }

  keyUri(email: string, secret: string): string {
    return generateURI({
      issuer: 'BramhaV2',
      label: email,
      secret,
    })
  }

  // ── TOTP verification ───────────────────────────────────────────────────────

  verifyCode(secret: string, code: string): boolean {
    try {
      // epochTolerance: TOTP_WINDOW steps × 30s period = ±30s (±1 step)
      const result = verifySync({
        token: code,
        secret,
        epochTolerance: TOTP_WINDOW * TOTP_PERIOD,
      })
      return result.valid
    } catch {
      // otplib throws TokenLengthError / TokenTypeError for malformed tokens;
      // treat any format error as an invalid code rather than crashing.
      return false
    }
  }

  // ── AES-256-GCM encryption ──────────────────────────────────────────────────

  /**
   * Encrypt a plaintext TOTP secret string.
   * Format: Buffer.concat([iv(12), authTag(16), ciphertext])
   */
  encryptSecret(secret: string): Buffer {
    return this.encryptSecretWithKey(secret, this.masterKey)
  }

  /**
   * Internal helper exposed for testing with a custom key.
   */
  encryptSecretWithKey(secret: string, key: Buffer): Buffer {
    const ivBuf = randomBytes(12)
    // Convert Buffer to Uint8Array<ArrayBuffer> for TS 5.9+ strict compatibility
    const iv = Uint8Array.from(ivBuf)
    const secretKey = createSecretKey(new Uint8Array(key))
    const cipher = createCipheriv('aes-256-gcm', secretKey, iv)
    const encrypted = Buffer.concat([Uint8Array.from(cipher.update(secret, 'utf8')), Uint8Array.from(cipher.final())])
    const authTag = cipher.getAuthTag()
    return Buffer.concat([Uint8Array.from(ivBuf), Uint8Array.from(authTag), Uint8Array.from(encrypted)])
  }

  /**
   * Decrypt an encrypted TOTP secret buffer back to the plaintext string.
   * Throws on auth tag mismatch (tampering).
   */
  decryptSecret(enc: Buffer): string {
    return this.decryptSecretWithKey(enc, this.masterKey)
  }

  /**
   * Internal helper exposed for testing with a custom key.
   */
  decryptSecretWithKey(enc: Buffer, key: Buffer): string {
    // Convert Buffer slices to Uint8Array<ArrayBuffer> for TS 5.9+ strict compatibility
    const iv = Uint8Array.from(enc.subarray(0, 12))
    const authTag = Uint8Array.from(enc.subarray(12, 28))
    const ciphertext = Uint8Array.from(enc.subarray(28))
    const secretKey = createSecretKey(new Uint8Array(key))
    const decipher = createDecipheriv('aes-256-gcm', secretKey, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([Uint8Array.from(decipher.update(ciphertext)), Uint8Array.from(decipher.final())]).toString('utf8')
  }
}
