import { Controller, Get, Post, Body, Req, UseGuards, HttpCode } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { FeedbackService } from './feedback.service.js';
import type { FeedbackRow } from './feedback.service.js';

type AuthedRequest = FastifyRequest & { user: { id: string; email: string; name: string } };

const CreateFeedbackSchema = z.object({
  content: z.string().min(1).max(5000),
  path: z.string().max(500).optional(),
});
type CreateFeedbackInput = z.infer<typeof CreateFeedbackSchema>;

@Controller('feedback')
@UseGuards(SessionAuthGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(CreateFeedbackSchema)) body: CreateFeedbackInput,
    @Req() req: AuthedRequest,
  ): Promise<FeedbackRow> {
    return this.feedbackService.create(req.user.id, body.content, body.path ?? null);
  }

  @Get('mine')
  async mine(@Req() req: AuthedRequest): Promise<FeedbackRow[]> {
    return this.feedbackService.listMine(req.user.id);
  }
}
