import { createZodDto } from 'nestjs-zod'
import { VerifyEmailInputSchema } from '@bramha/shared'

export class VerifyEmailDto extends createZodDto(VerifyEmailInputSchema) {}
