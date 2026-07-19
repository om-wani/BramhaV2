import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ConversationService } from './conversation.service.js';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { ProjectMemberGuard } from '../../common/guards/project-member.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

type AuthenticatedRequest = FastifyRequest & {
  user: { id: string; email: string; name: string };
  params: Record<string, string>;
};

const InsertNodeSchema = z.object({
  branchId: z.string().uuid(),
  content: z.string().min(1),
  parentNodeId: z.string().uuid().optional(),
});

const CreateBranchSchema = z.object({
  fromNodeId: z.string().uuid(),
  name: z.string().min(1).max(100),
});

type InsertNodeInput = z.infer<typeof InsertNodeSchema>;
type CreateBranchInput = z.infer<typeof CreateBranchSchema>;

@Controller('projects/:projectId/rooms/:roomId')
@UseGuards(SessionAuthGuard, ProjectMemberGuard('member'))
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  // POST /projects/:projectId/rooms/:roomId/nodes
  @Post('nodes')
  @HttpCode(201)
  async insertNode(
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Body(new ZodValidationPipe(InsertNodeSchema)) body: InsertNodeInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.conversationService.insertNode(
      req.user.id,
      projectId,
      roomId,
      body.branchId,
      body.content,
      body.parentNodeId,
    );
  }

  // POST /projects/:projectId/rooms/:roomId/branches
  @Post('branches')
  @HttpCode(201)
  async createBranch(
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Body(new ZodValidationPipe(CreateBranchSchema)) body: CreateBranchInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.conversationService.createBranch(
      req.user.id,
      projectId,
      roomId,
      body.fromNodeId,
      body.name,
    );
  }

  // GET /projects/:projectId/rooms/:roomId/branches/:branchId/thread
  @Get('branches/:branchId/thread')
  async getThread(
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Param('branchId') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.conversationService.getThread(req.user.id, projectId, roomId, branchId);
  }

  // GET /projects/:projectId/rooms/:roomId/branches
  @Get('branches')
  async listBranches(
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.conversationService.listBranches(req.user.id, projectId, roomId);
  }
}
