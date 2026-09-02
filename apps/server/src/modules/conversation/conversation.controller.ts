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
  Res,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ConversationService } from './conversation.service.js';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { ProjectMemberGuard } from '../../common/guards/project-member.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AgentsService } from '../agents/agents.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { eventBus } from '@bramha/event-bus';
import { getDb, branches, conversationNodes } from '@bramha/db';
import type {
  BranchCreatedEvent,
  NodeCreatedEvent,
  PersonaSlug,
} from '@bramha/shared';
import { and, eq } from 'drizzle-orm';

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
        // Room → candidate agents:
        //  - council: all 8, relevance-scored (roomKind 'council').
        //  - custom:  only the room's selected agents, scored among themselves.
        //  - one_on_one (legacy): the single bound agent (roomKind 'one_on_one').
        const allowedPersonas =
          room.kind === 'custom' ? (room.personas as PersonaSlug[]) : undefined;
        const roomKind: 'council' | 'one_on_one' =
          room.kind === 'one_on_one' ? 'one_on_one' : 'council';

        await this.agentsService.triggerAgentTurn({
          projectId,
          roomId,
          branchId: effectiveBranchId,
          orgName: 'org', // TODO: fetch from project in P3.4 — placeholder for now
          userNodeId: result.nodeId,
          userMessage: body.content,
          roomKind,
          ...(allowedPersonas && allowedPersonas.length > 0 ? { allowedPersonas } : {}),
          ...(room.persona !== null && room.kind === 'one_on_one'
            ? { boundPersona: room.persona as PersonaSlug }
            : {}),
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

  // GET /projects/:projectId/rooms/:roomId/stream
  @Get('stream')
  async streamRoomEvents(
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Req() _req: AuthenticatedRequest,
    @Res() res: FastifyReply,
  ): Promise<void> {
    // The stream writes directly to Node's response; prevent Nest/Fastify
    // from trying to serialize and finish the route after this method returns.
    res.hijack();
    res.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    res.raw.setHeader('Connection', 'keep-alive');
    res.raw.setHeader('X-Accel-Buffering', 'no');
    res.raw.flushHeaders?.();

    const sendEvent = (event: string, payload: unknown) => {
      res.raw.write(`event: ${event}\n`);
      res.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const unsubscribers: Array<() => void> = [];
    const isOpen = () => !res.raw.writableEnded && !res.raw.destroyed;

    const unsubNode = eventBus.on('node.created', async (event) => {
      if (event.projectId !== projectId || event.roomId !== roomId) return;
      const db = await getDb();
      const [node] = await db
        .select({
          id: conversationNodes.id,
          parentId: conversationNodes.parentId,
          authorType: conversationNodes.authorType,
          userId: conversationNodes.userId,
          persona: conversationNodes.persona,
          content: conversationNodes.content,
          metadata: conversationNodes.metadata,
          createdAt: conversationNodes.createdAt,
        })
        .from(conversationNodes)
        .where(eq(conversationNodes.id, event.nodeId));
      if (!isOpen()) return;
      const payload: NodeCreatedEvent = {
        type: 'node:created',
        node: {
          id: node?.id ?? event.nodeId,
          roomId,
          projectId,
          parentId: node?.parentId ?? null,
          authorType: (node?.authorType ?? 'system') as NodeCreatedEvent['node']['authorType'],
          userId: node?.userId ?? null,
          persona: node?.persona ?? null,
          content: node?.content ?? '',
          metadata: (node?.metadata ?? {}) as Record<string, unknown>,
          createdAt: node?.createdAt?.toISOString() ?? new Date().toISOString(),
        },
      };
      sendEvent('node:created', payload);
    });

    const unsubStreaming = eventBus.on('node.streaming', (event) => {
      if (event.projectId !== projectId || event.roomId !== roomId || !isOpen()) return;
      sendEvent('node:delta', {
        type: 'node:delta',
        nodeId: event.nodeId,
        seq: event.seq,
        text: event.text,
      });
    });

    const unsubError = eventBus.on('node.error', (event) => {
      if (event.projectId !== projectId || event.roomId !== roomId || !isOpen()) return;
      sendEvent('node:error', {
        type: 'node:error',
        nodeId: event.nodeId,
        code: event.code,
      });
    });

    const unsubBranch = eventBus.on('branch.created', async (event) => {
      if (event.projectId !== projectId || event.roomId !== roomId) return;
      const db = await getDb();
      const [branch] = await db
        .select({
          id: branches.id,
          name: branches.name,
          headNodeId: branches.headNodeId,
          forkedFromNodeId: branches.forkedFromNodeId,
          createdBy: branches.createdBy,
          createdAt: branches.createdAt,
        })
        .from(branches)
        .where(and(eq(branches.id, event.branchId), eq(branches.projectId, projectId)));
      if (!isOpen()) return;
      const payload: BranchCreatedEvent = {
        type: 'branch:created',
        branch: {
          id: branch?.id ?? event.branchId,
          roomId,
          projectId,
          name: branch?.name ?? '',
          headNodeId: branch?.headNodeId ?? null,
          forkedFromNodeId: branch?.forkedFromNodeId ?? null,
          createdBy: branch?.createdBy ?? '',
          createdAt: branch?.createdAt?.toISOString() ?? new Date().toISOString(),
        },
      };
      sendEvent('branch:created', payload);
    });

    const unsubDelegation = eventBus.on('delegation.pending', (event) => {
      if (event.projectId !== projectId || event.roomId !== roomId || !isOpen()) return;
      sendEvent('delegation:pending', {
        type: 'delegation:pending',
        taskId: event.taskId,
        roomId,
        fromPersona: event.fromPersona,
        toPersona: event.toPersona,
        task: event.task,
      });
    });

    const unsubSelection = eventBus.on('turn.selection', (event) => {
      if (event.projectId !== projectId || event.roomId !== roomId || !isOpen()) return;
      sendEvent('turn:selection', {
        type: 'turn:selection',
        userNodeId: event.userNodeId,
        scores: event.scores,
      });
    });

    unsubscribers.push(
      unsubNode,
      unsubStreaming,
      unsubError,
      unsubBranch,
      unsubDelegation,
      unsubSelection,
    );

    const heartbeat = setInterval(() => {
      if (isOpen()) {
        res.raw.write(': heartbeat\n\n');
      }
    }, 15000);

    res.raw.on('close', () => {
      clearInterval(heartbeat);
      for (const unsub of unsubscribers) unsub();
      res.raw.end();
    });

    res.raw.write('event: connected\n');
    res.raw.write(`data: ${JSON.stringify({ roomId, projectId })}\n\n`);
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
