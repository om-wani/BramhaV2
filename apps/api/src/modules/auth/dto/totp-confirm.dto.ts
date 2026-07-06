import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

const TotpConfirmSchema = z
  .object({
    code: z.string().length(6),
    pendingToken: z.string().min(1),
  })
  .strict()

export class TotpConfirmDto extends createZodDto(TotpConfirmSchema) {}
