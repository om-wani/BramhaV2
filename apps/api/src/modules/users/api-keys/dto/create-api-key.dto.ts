import { createZodDto } from 'nestjs-zod'
import { CreateApiKeyInputSchema } from '@bramha/shared'

export class CreateApiKeyDto extends createZodDto(CreateApiKeyInputSchema) {}
