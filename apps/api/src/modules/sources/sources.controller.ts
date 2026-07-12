import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'
import { CreateSourceInputSchema } from '@bramha/shared'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard.js'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator.js'
import { SourcesService } from './sources.service.js'

class CreateSourceDto extends createZodDto(CreateSourceInputSchema) {}

@Controller('projects/:projectId/sources')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  /** POST /projects/:projectId/sources */
  @Post()
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  @HttpCode(HttpStatus.CREATED)
  createSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() body: CreateSourceDto,
  ) {
    return this.sources.createSource(user.userId, projectId, body)
  }

  /** GET /projects/:projectId/sources */
  @Get()
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  listSources(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ) {
    return this.sources.listSources(user.userId, projectId)
  }

  /** GET /projects/:projectId/sources/:sourceId */
  @Get(':sourceId')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  getSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.sources.getSource(user.userId, projectId, sourceId)
  }

  /** DELETE /projects/:projectId/sources/:sourceId */
  @Delete(':sourceId')
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.sources.deleteSource(user.userId, projectId, sourceId)
  }

  /** POST /projects/:projectId/sources/:sourceId/sync */
  @Post(':sourceId/sync')
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  triggerSync(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.sources.triggerSync(user.userId, projectId, sourceId)
  }

  /** GET /projects/:projectId/sources/:sourceId/history */
  @Get(':sourceId/history')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  getHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.sources.getHistory(user.userId, projectId, sourceId)
  }
}
