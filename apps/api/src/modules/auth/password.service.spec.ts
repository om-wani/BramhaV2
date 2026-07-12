import { describe, it, expect } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { PasswordService } from './password.service.js'

describe('PasswordService', () => {
  const svc = new PasswordService()

  describe('hash + verify round-trip', () => {
    it('hashes a password and verifies it correctly', async () => {
      const hash = await svc.hash('CorrectHorseBatteryStaple99!')
      expect(hash).toMatch(/^\$argon2id\$/)
      const ok = await svc.verify(hash, 'CorrectHorseBatteryStaple99!')
      expect(ok).toBe(true)
    })

    it('returns false for wrong password', async () => {
      const hash = await svc.hash('CorrectHorseBatteryStaple99!')
      const ok = await svc.verify(hash, 'WrongPassword123')
      expect(ok).toBe(false)
    })
  })

  describe('checkStrength', () => {
    it('throws BadRequestException with code password_too_weak for weak password', () => {
      expect(() => svc.checkStrength('password')).toThrow(BadRequestException)
      try {
        svc.checkStrength('password')
      } catch (e) {
        const err = e as BadRequestException
        const resp = err.getResponse() as Record<string, unknown>
        expect(resp['code']).toBe('password_too_weak')
      }
    })

    it('does not throw for strong password (score >= 3)', () => {
      // "correct horse battery staple" style — known zxcvbn score 4
      expect(() => svc.checkStrength('correctHorseBatteryStaple9!')).not.toThrow()
    })

    it('throws for common dictionary word', () => {
      expect(() => svc.checkStrength('iloveyou')).toThrow(BadRequestException)
    })
  })
})
