import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'
import {
  CreateRoomInputSchema,
  UpdateRoomInputSchema,
  AddParticipantInputSchema,
} from '@bramha/shared'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator'
import {
  ProjectViewerGuard,
  ProjectEditorGuard,
} from '../common/guards/project-member.guard'
import { RoomsService, type RoomDto, type ParticipantDto } from './rooms.service'

class CreateRoomDto extends createZodDto(CreateRoomInputSchema) {}
class UpdateRoomDto extends createZodDto(UpdateRoomInputSchema) {}
class AddParticipantDto extends createZodDto(AddParticipantInputSchema) {}

@Controller('projects/:projectId/rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  /** POST /projects/:projectId/rooms — Create room (editor+) */
  @Post()
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() body: CreateRoomDto,
  ): Promise<RoomDto> {
    return this.rooms.create(user.userId, projectId, body)
  }

  /** GET /projects/:projectId/rooms — List rooms (viewer+) */
  @Get()
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ): Promise<RoomDto[]> {
    return this.rooms.list(user.userId, projectId)
  }

  /** GET /projects/:projectId/rooms/:roomId — Get room (viewer+) */
  @Get(':roomId')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
  ): Promise<RoomDto> {
    return this.rooms.getById(user.userId, projectId, roomId)
  }

  /** PATCH /projects/:projectId/rooms/:roomId — Update room (editor+) */
  @Patch(':roomId')
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Body() body: UpdateRoomDto,
  ): Promise<RoomDto> {
    return this.rooms.update(user.userId, projectId, roomId, body)
  }

  /** POST /projects/:projectId/rooms/:roomId/participants — Add participant (editor+) */
  @Post(':roomId/participants')
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  @HttpCode(HttpStatus.CREATED)
  addParticipant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Body() body: AddParticipantDto,
  ): Promise<ParticipantDto> {
    return this.rooms.addParticipant(user.userId, projectId, roomId, body)
  }

  /** DELETE /projects/:projectId/rooms/:roomId/participants/:participantId — Remove participant (editor+) */
  @Delete(':roomId/participants/:participantId')
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeParticipant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Param('participantId') participantId: string,
  ): Promise<void> {
    return this.rooms.removeParticipant(user.userId, projectId, roomId, participantId)
  }
}
