import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'
import { InitiateUploadInputSchema } from '@bramha/shared'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator'
import { FilesService } from './files.service'

class InitiateUploadDto extends createZodDto(InitiateUploadInputSchema) {}

@Controller('projects/:projectId/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** POST /projects/:projectId/files/initiate */
  @Post('initiate')
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  @HttpCode(HttpStatus.CREATED)
  initiateUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() body: InitiateUploadDto,
  ) {
    return this.files.initiateUpload(user.userId, projectId, body)
  }

  /** POST /projects/:projectId/files/:fileId/confirm */
  @Post(':fileId/confirm')
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  confirmUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.files.confirmUpload(user.userId, projectId, fileId)
  }

  /** GET /projects/:projectId/files */
  @Get()
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  listFiles(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ) {
    return this.files.listFiles(user.userId, projectId)
  }

  /** GET /projects/:projectId/files/:fileId */
  @Get(':fileId')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  getFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.files.getFile(user.userId, projectId, fileId)
  }

  /** GET /projects/:projectId/files/:fileId/download-url */
  @Get(':fileId/download-url')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  getDownloadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.files.getDownloadUrl(user.userId, projectId, fileId)
  }
}
