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
import { PERSONA_SLUGS } from '@bramha/shared';
import { RoomsService } from './rooms.service.js';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { ProjectMemberGuard } from '../../common/guards/project-member.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

type AuthenticatedRequest = FastifyRequest & {
  user: { id: string; email: string; name: string };
  params: Record<string, string>;
};

const CreateRoomSchema = z
  .object({
    name: z.string().min(1).max(100),
    kind: z.enum(['council', 'one_on_one']),
    persona: z.string().optional(),
  })
  .refine(
    (d) =>
      d.kind !== 'one_on_one' ||
      (d.persona !== undefined && (PERSONA_SLUGS as readonly string[]).includes(d.persona)),
    { message: 'one_on_one rooms require a valid persona slug', path: ['persona'] },
  )
  .refine((d) => d.kind !== 'council' || d.persona === undefined, {
    message: 'council rooms must not specify a persona',
    path: ['persona'],
  });

type CreateRoomInput = z.infer<typeof CreateRoomSchema>;

@Controller('projects/:projectId/rooms')
@UseGuards(SessionAuthGuard, ProjectMemberGuard('member'))
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @HttpCode(201)
  async createRoom(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(CreateRoomSchema)) body: CreateRoomInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.roomsService.createRoom(req.user.id, projectId, body.name, body.kind, body.persona);
  }

  @Get()
  async listRooms(
    @Param('projectId') projectId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.roomsService.listRooms(req.user.id, projectId);
  }
}
