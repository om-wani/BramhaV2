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
import { PERSONA_SLUGS } from '@bramha/shared';
import { RoomsService } from './rooms.service.js';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { ProjectMemberGuard } from '../../common/guards/project-member.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

type AuthenticatedRequest = FastifyRequest & {
  user: { id: string; email: string; name: string };
  params: Record<string, string>;
};

// Custom rooms only — a name plus 1..8 valid, distinct agent slugs. The council
// conference room is auto-seeded per project and is not creatable here.
const CreateRoomSchema = z.object({
  name: z.string().min(1).max(100),
  personas: z
    .array(z.enum(PERSONA_SLUGS as unknown as [string, ...string[]]))
    .min(1)
    .max(8)
    .refine((arr) => new Set(arr).size === arr.length, { message: 'Duplicate agents' }),
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
    return this.roomsService.createRoom(req.user.id, projectId, body.name, body.personas);
  }

  @Get()
  async listRooms(@Param('projectId') projectId: string, @Req() req: AuthenticatedRequest) {
    return this.roomsService.listRooms(req.user.id, projectId);
  }

  @Delete(':roomId')
  @HttpCode(204)
  async deleteRoom(
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.roomsService.deleteRoom(req.user.id, projectId, roomId);
  }
}
