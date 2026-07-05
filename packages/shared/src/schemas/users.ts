import { z } from 'zod'
import {
  uuidSchema,
  emailSchema,
  passwordSchema,
  displayNameSchema,
  isoDateSchema,
} from './common.js'

export const UserStatusSchema = z.enum(['active', 'suspended'])

export const UserSchema = z
  .object({
    id: uuidSchema,
    email: emailSchema,
    emailVerifiedAt: isoDateSchema.nullable(),
    displayName: displayNameSchema,
    avatarKey: z.string().nullable(),
    isAdmin: z.boolean(),
    status: UserStatusSchema,
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict()

export type User = z.infer<typeof UserSchema>

// Auth inputs
export const RegisterInputSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: displayNameSchema,
  })
  .strict()

export type RegisterInput = z.infer<typeof RegisterInputSchema>

export const LoginInputSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1),
    totp: z
      .string()
      .length(6)
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict()

export type LoginInput = z.infer<typeof LoginInputSchema>

export const UpdateProfileInputSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    avatarKey: z.string().nullable().optional(),
  })
  .strict()

export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>

export const VerifyEmailInputSchema = z
  .object({
    token: z.string().min(32).max(128),
  })
  .strict()

export type VerifyEmailInput = z.infer<typeof VerifyEmailInputSchema>
