import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'
import { HirePersonaInputSchema } from '@bramha/shared'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator'
import {
  ProjectViewerGuard,
  ProjectEditorGuard,
} from '../common/guards/project-member.guard'
import { RoomsService, type HiredPersonaDto, type RoomDto, type TokenUsageDto } from './rooms.service'

class HirePersonaDto extends createZodDto(HirePersonaInputSchema) {}

@Controller('projects/:projectId/agents')
export class ProjectAgentsController {
  constructor(private readonly rooms: RoomsService) {}

  /** GET /projects/:projectId/agents — List hired personas (viewer+) */
  @Get()
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  listHiredPersonas(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ): Promise<HiredPersonaDto[]> {
    return this.rooms.listHiredPersonas(user.userId, projectId)
  }

  /** POST /projects/:projectId/agents — Hire a persona (editor+) */
  @Post()
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  @HttpCode(HttpStatus.CREATED)
  hirePersona(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() body: HirePersonaDto,
  ): Promise<HiredPersonaDto> {
    return this.rooms.hirePersona(user.userId, projectId, body.personaId)
  }

  /** DELETE /projects/:projectId/agents/:personaId — Fire a persona (editor+) */
  @Delete(':personaId')
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  firePersona(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('personaId') personaId: string,
  ): Promise<void> {
    return this.rooms.firePersona(user.userId, projectId, personaId)
  }

  /** GET /projects/:projectId/agents/:personaId/call-room — Get or create 1:1 call room */
  @Get(':personaId/call-room')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  getCallRoom(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('personaId') personaId: string,
  ): Promise<RoomDto> {
    return this.rooms.getOrCreateCallRoom(user.userId, projectId, personaId)
  }
}

/** GET /projects/:projectId/token-usage — list token usage rows with room type */
@Controller('projects/:projectId/token-usage')
export class TokenUsageController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  listTokenUsage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ): Promise<TokenUsageDto[]> {
    return this.rooms.listTokenUsage(user.userId, projectId)
  }
}
