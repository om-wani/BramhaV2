import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

const TotpChallengeSchema = z.object({
  preAuthToken: z.string().min(1),
  code: z.string().min(6).max(8),
})

export class TotpChallengeDto extends createZodDto(TotpChallengeSchema) {}
