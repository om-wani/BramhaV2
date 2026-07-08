import {
  Controller, Post, Get, Patch, Delete, Param, Body, Query,
  UseGuards, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'
import { CreateNoteInputSchema, UpdateNoteInputSchema, MoveFolderInputSchema } from '@bramha/shared'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator'
import { NotesService } from './notes.service'

class CreateNoteDto extends createZodDto(CreateNoteInputSchema) {}
class UpdateNoteDto extends createZodDto(UpdateNoteInputSchema) {}
class MoveFolderDto extends createZodDto(MoveFolderInputSchema) {}

@Controller('projects/:projectId/notes')
@UseGuards(JwtAuthGuard, ProjectViewerGuard)
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post()
  @UseGuards(ProjectEditorGuard)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateNoteDto,
  ) {
    return this.notes.create(user.userId, projectId, body)
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('folder') folder?: string,
  ) {
    return this.notes.list(user.userId, projectId, folder)
  }

  @Get('deleted')
  listDeleted(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.notes.listDeleted(user.userId, projectId)
  }

  @Get(':noteId')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    return this.notes.get(user.userId, projectId, noteId)
  }

  @Patch(':noteId')
  @UseGuards(ProjectEditorGuard)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() body: UpdateNoteDto,
  ) {
    return this.notes.update(user.userId, projectId, noteId, body)
  }

  @Delete(':noteId')
  @UseGuards(ProjectEditorGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    return this.notes.delete(user.userId, projectId, noteId)
  }

  @Post(':noteId/restore')
  @UseGuards(ProjectEditorGuard)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    return this.notes.restore(user.userId, projectId, noteId)
  }

  @Patch(':noteId/move')
  @UseGuards(ProjectEditorGuard)
  move(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() body: MoveFolderDto,
  ) {
    return this.notes.move(user.userId, projectId, noteId, body.folderPath)
  }

  @Get(':noteId/backlinks')
  getBacklinks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    return this.notes.getBacklinks(user.userId, projectId, noteId)
  }
}
