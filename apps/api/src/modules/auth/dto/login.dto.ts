import { createZodDto } from 'nestjs-zod'
import { LoginInputSchema } from '@bramha/shared'

export class LoginDto extends createZodDto(LoginInputSchema) {}
