import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { UsageService } from './usage.service.js';
import type { UsageSummary } from './usage.service.js';

type AuthenticatedRequest = FastifyRequest & {
  user: { id: string; email: string; name: string };
};

@Controller('usage')
@UseGuards(SessionAuthGuard)
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  // GET /usage/me — aggregate model-call usage across the caller's projects
  @Get('me')
  async getMyUsage(@Req() req: AuthenticatedRequest): Promise<UsageSummary> {
    return this.usageService.getUsageForUser(req.user.id);
  }
}
