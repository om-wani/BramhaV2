import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ConversationService } from './conversation.service.js';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { ProjectMemberGuard } from '../../common/guards/project-member.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AgentsService } from '../agents/agents.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { eventBus } from '@bramha/event-bus';
import type { PersonaSlug } from '@bramha/shared';

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
  private readonly logger = new Logger(ConversationController.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly agentsService: AgentsService,
    private readonly roomsService: RoomsService,
  ) {}

  // POST /projects/:projectId/rooms/:roomId/nodes
  @Post('nodes')
  @HttpCode(201)
  async insertNode(
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Body(new ZodValidationPipe(InsertNodeSchema)) body: InsertNodeInput,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.conversationService.insertNode(
      req.user.id,
      projectId,
      roomId,
      body.branchId,
      body.content,
      body.parentNodeId,
    );

    const effectiveBranchId = result.newBranchId ?? result.branchId;

    // Fire-and-forget agent turn
    void (async () => {
      try {
        const room = await this.roomsService.getRoomForProject(roomId, projectId);
        if (!room) return;
        const thread = await this.conversationService.getThread(
          req.user.id,
          projectId,
          roomId,
          effectiveBranchId,
        );
        await this.agentsService.triggerAgentTurn({
          projectId,
          roomId,
          branchId: effectiveBranchId,
          orgName: 'org', // TODO: fetch from project in P3.4 — placeholder for now
          userNodeId: result.nodeId,
          userMessage: body.content,
          roomKind: room.kind as 'council' | 'one_on_one',
          ...(room.persona !== null ? { boundPersona: room.persona as PersonaSlug } : {}),
          userId: req.user.id,
          thread,
        });
      } catch (err) {
        this.logger.error('agent turn failed', err);
        // Tell connected clients the turn died so the UI stops waiting
        eventBus.emit({
          type: 'node.error',
          projectId,
          roomId,
          nodeId: `turn-${result.nodeId}`,
          code: 'AGENT_TURN_FAILED',
        });
      }
    })();

    return result;
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
