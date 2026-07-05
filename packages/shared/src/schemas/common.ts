import { z } from 'zod'

export const uuidSchema = z.string().uuid()

export const emailSchema = z
  .string()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase().trim())

export const slugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase alphanumeric with hyphens')

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')

export const displayNameSchema = z.string().min(1).max(100).trim()

export const isoDateSchema = z.string().datetime({ offset: true })

export const paginationSchema = z
  .object({
    page: z.number().int().positive().default(1),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict()
