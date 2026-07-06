import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

const TotpConfirmSchema = z.object({
  code: z.string().length(6),
})

export class TotpConfirmDto extends createZodDto(TotpConfirmSchema) {}
