import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema?: ZodSchema) {}

  transform(value: unknown) {
    if (this.schema === undefined) return value;
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        type: 'about:blank',
        title: 'Validation Error',
        status: 400,
        detail: result.error.message,
        code: 'VALIDATION_ERROR',
      });
    }
    return result.data;
  }
}
