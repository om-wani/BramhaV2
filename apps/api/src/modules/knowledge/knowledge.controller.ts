import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'
import { SearchKnowledgeInputSchema } from '@bramha/shared'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { ProjectViewerGuard } from '../common/guards/project-member.guard'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator'
import { KnowledgeService } from './knowledge.service'
import type { KnowledgeSearchResult } from '@bramha/shared'

class SearchKnowledgeDto extends createZodDto(SearchKnowledgeInputSchema) {}

@Controller('projects/:projectId/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  /**
   * POST /projects/:projectId/knowledge/search
   *
   * Rate limited: 20 searches per user per minute (enforced in service).
   * Requires project viewer membership (RLS enforces tenant isolation at DB level).
   */
  @Post('search')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  @HttpCode(HttpStatus.OK)
  async search(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: SearchKnowledgeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<KnowledgeSearchResult> {
    return this.knowledge.search({
      projectId,
      userId: user.userId,
      query: dto.query,
      ...(dto.origins !== undefined ? { origins: dto.origins } : {}),
      limit: dto.limit,
    })
  }
}
