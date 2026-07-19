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
import { ProjectsService } from './projects.service.js';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { ProjectMemberGuard } from '../../common/guards/project-member.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

type AuthenticatedRequest = FastifyRequest & {
  user: { id: string; email: string; name: string };
  params: Record<string, string>;
};

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
});

const AddMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'member']),
});

type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
type AddMemberInput = z.infer<typeof AddMemberSchema>;

// ---------------------------------------------------------------------------
// Org-scoped routes: /orgs/:orgId/projects
// ---------------------------------------------------------------------------

@Controller('orgs')
@UseGuards(SessionAuthGuard)
export class OrgProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post(':orgId/projects')
  @HttpCode(201)
  async createProject(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(CreateProjectSchema)) body: CreateProjectInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ id: string; orgId: string; name: string; createdAt: Date }> {
    return this.projectsService.createProject(req.user.id, orgId, body.name);
  }

  @Get(':orgId/projects')
  async listProjects(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Array<{ id: string; name: string; createdAt: Date }>> {
    return this.projectsService.listProjects(req.user.id, orgId);
  }
}

// ---------------------------------------------------------------------------
// Project-scoped routes: /projects/:projectId
// ---------------------------------------------------------------------------

@Controller('projects')
@UseGuards(SessionAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get(':projectId')
  @UseGuards(ProjectMemberGuard('member'))
  async getProject(
    @Param('projectId') projectId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ id: string; orgId: string; name: string; createdAt: Date }> {
    return this.projectsService.getProject(req.user.id, projectId);
  }

  @Post(':projectId/members')
  @HttpCode(201)
  @UseGuards(ProjectMemberGuard('admin'))
  async addMember(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(AddMemberSchema)) body: AddMemberInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ projectId: string; userId: string; role: string }> {
    return this.projectsService.addMember(req.user.id, projectId, body.userId, body.role);
  }

  @Delete(':projectId/members/:userId')
  @UseGuards(ProjectMemberGuard('admin'))
  async removeMember(
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Record<string, never>> {
    await this.projectsService.removeMember(req.user.id, projectId, userId);
    return {};
  }
}
