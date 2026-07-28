import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  HttpCode,
  UseGuards,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getDb, delegationTasks, rooms } from '@bramha/db';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { ProjectMemberGuard } from '../../common/guards/project-member.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AgentsService } from './agents.service.js';
import type { PersonaSlug } from '@bramha/shared';

const ApproveSchema = z.object({
  branchId: z.string().uuid(),
});

type ApproveInput = z.infer<typeof ApproveSchema>;

@Controller('projects/:projectId/rooms/:roomId/delegations')
@UseGuards(SessionAuthGuard, ProjectMemberGuard('member'))
export class DelegationsController {
  constructor(private readonly agentsService: AgentsService) {}

  // POST .../delegations/:taskId/approve — run the pending delegated task
  @Post(':taskId/approve')
  @HttpCode(202)
  async approve(
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(ApproveSchema)) body: ApproveInput,
    @Req() req: FastifyRequest & { user: { id: string } },
  ): Promise<{ status: string }> {
    const db = await getDb();

    const [task] = await db
      .select()
      .from(delegationTasks)
      .where(
        and(
          eq(delegationTasks.id, taskId),
          eq(delegationTasks.roomId, roomId),
          eq(delegationTasks.projectId, projectId),
        ),
      );

    if (!task) throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    if (task.status !== 'pending') {
      throw new ConflictException({
        code: 'ALREADY_PROCESSED',
        title: `Task already ${task.status}`,
      });
    }

    const [room] = await db
      .select({ kind: rooms.kind })
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.projectId, projectId)));
    if (!room) throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });

    // Fire-and-forget: executeDelegationTask never throws (failure → 'failed')
    void this.agentsService.executeDelegationTask({
      taskId: task.id,
      projectId,
      roomId,
      branchId: body.branchId,
      orgName: 'org',
      roomKind: room.kind as 'council' | 'one_on_one',
      delegatingNodeId: task.sourceNodeId,
      fromPersona: task.fromPersona as PersonaSlug,
      toPersona: task.toPersona as PersonaSlug,
      task: task.task,
      triggerUserId: req.user.id,
    });

    return { status: 'running' };
  }

  // POST .../delegations/:taskId/deny — reject the pending task
  @Post(':taskId/deny')
  @HttpCode(200)
  async deny(
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Param('taskId') taskId: string,
  ): Promise<{ status: string }> {
    const db = await getDb();

    const updated = await db
      .update(delegationTasks)
      .set({ status: 'failed' })
      .where(
        and(
          eq(delegationTasks.id, taskId),
          eq(delegationTasks.roomId, roomId),
          eq(delegationTasks.projectId, projectId),
          eq(delegationTasks.status, 'pending'),
        ),
      )
      .returning();

    if (updated.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found or already processed' });
    }

    return { status: 'denied' };
  }
}
