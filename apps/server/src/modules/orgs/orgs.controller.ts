import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { OrgsService } from './orgs.service.js';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

type AuthenticatedRequest = FastifyRequest & { user: { id: string; email: string; name: string } };

const CreateOrgSchema = z.object({
  name: z.string().min(1).max(100),
});

const AddMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['owner', 'member']),
});

type CreateOrgInput = z.infer<typeof CreateOrgSchema>;
type AddMemberInput = z.infer<typeof AddMemberSchema>;

@Controller('orgs')
@UseGuards(SessionAuthGuard)
export class OrgsController {
  constructor(private readonly orgsService: OrgsService) {}

  @Post()
  @HttpCode(201)
  async createOrg(
    @Body(new ZodValidationPipe(CreateOrgSchema)) body: CreateOrgInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ id: string; name: string; createdAt: Date }> {
    return this.orgsService.createOrg(req.user.id, body.name);
  }

  @Get()
  async listOrgs(
    @Req() req: AuthenticatedRequest,
  ): Promise<Array<{ id: string; name: string; role: string; createdAt: Date }>> {
    return this.orgsService.listOrgsForUser(req.user.id);
  }

  @Post(':orgId/members')
  @HttpCode(201)
  async addMember(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(AddMemberSchema)) body: AddMemberInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ orgId: string; userId: string; role: string }> {
    return this.orgsService.addMember(req.user.id, orgId, body.userId, body.role);
  }

  @Delete(':orgId/members/:userId')
  @HttpCode(204)
  async removeMember(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.orgsService.removeMember(req.user.id, orgId, userId);
  }

  @Get(':orgId/members')
  async listMembers(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Array<{ userId: string; name: string; email: string; role: string }>> {
    return this.orgsService.listMembers(req.user.id, orgId);
  }
}
