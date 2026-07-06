import { createZodDto } from 'nestjs-zod'
import { ResetPasswordInputSchema } from '@bramha/shared'

export class ResetPasswordDto extends createZodDto(ResetPasswordInputSchema) {}
