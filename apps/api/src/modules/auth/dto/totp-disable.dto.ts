import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

const TotpDisableSchema = z.object({
  /** Either a valid TOTP code or a recovery code */
  code: z.string().min(6).max(20),
})

export class TotpDisableDto extends createZodDto(TotpDisableSchema) {}
