import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'
import { CreateArtifactInputSchema, CreateVersionInputSchema } from '@bramha/shared'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard'
import {
  ArtifactsService,
  type ArtifactDto,
  type ArtifactVersionDto,
  type CreateArtifactResult,
} from './artifacts.service'

class CreateArtifactDto extends createZodDto(CreateArtifactInputSchema) {}
class CreateVersionDto extends createZodDto(CreateVersionInputSchema) {}

@Controller('projects/:projectId/artifacts')
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  /** POST /projects/:projectId/artifacts — Create artifact (editor+) */
  @Post()
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() body: CreateArtifactDto,
  ): Promise<CreateArtifactResult> {
    return this.artifacts.create(user.userId, projectId, body)
  }

  /** POST /projects/:projectId/artifacts/:artifactId/versions — Create version (editor+) */
  @Post(':artifactId/versions')
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  @HttpCode(HttpStatus.CREATED)
  createVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('artifactId') artifactId: string,
    @Body() body: CreateVersionDto,
  ): Promise<ArtifactVersionDto> {
    return this.artifacts.createVersion(user.userId, projectId, artifactId, body)
  }

  /** GET /projects/:projectId/artifacts — List artifacts (viewer+, optional ?conversationId=) */
  @Get()
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query('conversationId') conversationId?: string,
  ): Promise<ArtifactDto[]> {
    return this.artifacts.list(user.userId, projectId, conversationId)
  }

  /** GET /projects/:projectId/artifacts/:artifactId/versions — List versions (viewer+) */
  @Get(':artifactId/versions')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  getVersions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('artifactId') artifactId: string,
  ): Promise<ArtifactVersionDto[]> {
    return this.artifacts.getVersions(user.userId, projectId, artifactId)
  }

  /** GET /projects/:projectId/artifacts/:artifactId/versions/:version/render-token — Issue render token (viewer+) */
  @Get(':artifactId/versions/:version/render-token')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  getRenderToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('artifactId') artifactId: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<{ token: string }> {
    return this.artifacts.getRenderToken(user.userId, projectId, artifactId, version)
  }

  /** GET /projects/:projectId/artifacts/:artifactId/versions/:version/url — Get presigned URL (requires ?token=) */
  @Get(':artifactId/versions/:version/url')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  getPresignedUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('artifactId') artifactId: string,
    @Param('version', ParseIntPipe) version: number,
    @Query('token') token: string,
  ): Promise<{ url: string }> {
    return this.artifacts.getPresignedUrl(user.userId, projectId, artifactId, version, token)
  }
}
