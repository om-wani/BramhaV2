import { z } from 'zod'

export const ForgotPasswordInputSchema = z
  .object({
    email: z.string().email(),
  })
  .strict()

export const ResetPasswordInputSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8),
  })
  .strict()

export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInputSchema>
export type ResetPasswordInput = z.infer<typeof ResetPasswordInputSchema>
