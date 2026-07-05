import { createZodDto } from 'nestjs-zod'
import { RegisterInputSchema } from '@bramha/shared'

export class RegisterDto extends createZodDto(RegisterInputSchema) {}
