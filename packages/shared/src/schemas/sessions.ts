import { z } from 'zod'
import { uuidSchema, isoDateSchema } from './common.js'

export const SessionSchema = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    userAgent: z.string().nullable(),
    ip: z.string().nullable(),
    expiresAt: isoDateSchema,
    revokedAt: isoDateSchema.nullable(),
    createdAt: isoDateSchema,
  })
  .strict()

export type Session = z.infer<typeof SessionSchema>

export const AuthTokensSchema = z
  .object({
    accessToken: z.string(),
    expiresIn: z.number(),
  })
  .strict()

export type AuthTokens = z.infer<typeof AuthTokensSchema>
