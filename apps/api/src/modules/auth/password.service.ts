import { Injectable, BadRequestException } from '@nestjs/common'
import * as argon2 from 'argon2'
import zxcvbn from 'zxcvbn'

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456, // 19 MiB
      timeCost: 2,
      parallelism: 1,
    })
  }

  async verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password)
  }

  checkStrength(password: string): void {
    const result = zxcvbn(password)
    if (result.score < 3) {
      throw new BadRequestException({
        code: 'password_too_weak',
        message: 'Password is too weak',
        detail:
          result.feedback.suggestions.join(' ') ||
          result.feedback.warning ||
          'Use a longer password with mixed characters',
      })
    }
  }
}
