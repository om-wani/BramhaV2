import { z } from 'zod'

export const CreateApiKeyInputSchema = z
  .object({
    name: z.string().min(1).max(100),
    scopes: z.array(z.enum(['read', 'write'])).min(1).max(2),
  })
  .strict()

export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>
