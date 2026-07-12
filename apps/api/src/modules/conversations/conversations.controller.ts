import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'
import {
  CreateConversationInputSchema,
  AppendNodeInputSchema,
  ForkInputSchema,
  UpdateBranchInputSchema,
} from '@bramha/shared'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator.js'
import {
  ProjectViewerGuard,
  ProjectEditorGuard,
} from '../common/guards/project-member.guard.js'
import {
  ConversationsService,
  type ConversationDto,
  type ConversationNodeDto,
  type BranchDto,
  type GraphDto,
  type SliceDto,
} from './conversations.service.js'

class CreateConversationDto extends createZodDto(CreateConversationInputSchema) {}
class AppendNodeDto extends createZodDto(AppendNodeInputSchema) {}
class ForkDto extends createZodDto(ForkInputSchema) {}
class UpdateBranchDto extends createZodDto(UpdateBranchInputSchema) {}

@Controller('projects/:projectId/rooms/:roomId/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  /** POST /projects/:projectId/rooms/:roomId/conversations — Create conversation (editor+) */
  @Post()
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Body() body: CreateConversationDto,
  ): Promise<ConversationDto> {
    return this.conversations.create(user.userId, projectId, roomId, body)
  }

  /** GET /projects/:projectId/rooms/:roomId/conversations/:convId — Get conversation (viewer+) */
  @Get(':convId')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Param('convId') convId: string,
  ): Promise<ConversationDto> {
    return this.conversations.getById(user.userId, projectId, roomId, convId)
  }

  /** POST /projects/:projectId/rooms/:roomId/conversations/:convId/nodes — Append node (editor+) */
  @Post(':convId/nodes')
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  @HttpCode(HttpStatus.CREATED)
  appendNode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Param('convId') convId: string,
    @Body() body: AppendNodeDto,
  ): Promise<ConversationNodeDto> {
    return this.conversations.appendNode(user.userId, projectId, roomId, convId, body)
  }

  /** POST /projects/:projectId/rooms/:roomId/conversations/:convId/fork — Fork conversation (editor+) */
  @Post(':convId/fork')
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  @HttpCode(HttpStatus.CREATED)
  fork(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Param('convId') convId: string,
    @Body() body: ForkDto,
  ): Promise<BranchDto> {
    return this.conversations.fork(user.userId, projectId, roomId, convId, body)
  }

  /** GET /projects/:projectId/rooms/:roomId/conversations/:convId/graph — Full DAG (viewer+) */
  @Get(':convId/graph')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  getGraph(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Param('convId') convId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('branchId') branchId?: string,
  ): Promise<GraphDto> {
    return this.conversations.getGraph(user.userId, projectId, roomId, convId, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      branchId,
    })
  }

  /** GET /projects/:projectId/rooms/:roomId/conversations/:convId/slice — Ancestor slice (viewer+) */
  @Get(':convId/slice')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  getSlice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Param('convId') convId: string,
    @Query('branchId') branchId: string,
    @Query('tokenBudget') tokenBudget?: string,
  ): Promise<SliceDto> {
    return this.conversations.getSlice(user.userId, projectId, roomId, convId, {
      branchId,
      tokenBudget: tokenBudget ? parseInt(tokenBudget, 10) : undefined,
    })
  }

  /** GET /projects/:projectId/rooms/:roomId/conversations/:convId/branches — List branches (viewer+) */
  @Get(':convId/branches')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  listBranches(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Param('convId') convId: string,
  ): Promise<BranchDto[]> {
    return this.conversations.listBranches(user.userId, projectId, roomId, convId)
  }

  /** PATCH /projects/:projectId/rooms/:roomId/conversations/:convId/branches/:branchId — Update branch (editor+) */
  @Patch(':convId/branches/:branchId')
  @UseGuards(JwtAuthGuard, ProjectEditorGuard)
  updateBranch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Param('convId') convId: string,
    @Param('branchId') branchId: string,
    @Body() body: UpdateBranchDto,
  ): Promise<BranchDto> {
    return this.conversations.updateBranch(user.userId, projectId, roomId, convId, branchId, body)
  }
}
