import { createZodDto } from 'nestjs-zod'
import { ForgotPasswordInputSchema } from '@bramha/shared'

export class ForgotPasswordDto extends createZodDto(ForgotPasswordInputSchema) {}
