/**
 * DelegationsController — REST API for delegation management.
 *
 * Endpoints:
 *   GET    /projects/:projectId/delegations               — list (paginated, status filter)
 *   GET    /projects/:projectId/delegations/:delegationId — get single
 *   DELETE /projects/:projectId/delegations/:delegationId — cancel
 *
 * Guards: JwtAuthGuard + ProjectViewerGuard on all endpoints.
 */

import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator'
import { ProjectViewerGuard } from '../common/guards/project-member.guard'
import {
  DelegationsService,
  type DelegationDto,
  type ListDelegationsResult,
} from './delegations.service'

@Controller('projects/:projectId/delegations')
@UseGuards(JwtAuthGuard, ProjectViewerGuard)
export class DelegationsController {
  constructor(private readonly delegations: DelegationsService) {}

  /**
   * GET /projects/:projectId/delegations
   * List delegations for a project (paginated, optional status filter).
   *
   * Query params:
   *   status?  — filter by status string ('queued', 'running', 'completed', etc.)
   *   limit?   — page size (default 20, max 100)
   *   offset?  — page offset (default 0)
   */
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ListDelegationsResult> {
    return this.delegations.list(user.userId, projectId, {
      ...(status !== undefined ? { status } : {}),
      ...(limit !== undefined ? { limit: parseInt(limit, 10) } : {}),
      ...(offset !== undefined ? { offset: parseInt(offset, 10) } : {}),
    })
  }

  /**
   * GET /projects/:projectId/delegations/:delegationId
   * Get a single delegation by ID.
   */
  @Get(':delegationId')
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('delegationId') delegationId: string,
  ): Promise<DelegationDto> {
    return this.delegations.getById(user.userId, projectId, delegationId)
  }

  /**
   * DELETE /projects/:projectId/delegations/:delegationId
   * Cancel a delegation.
   * Returns 204 No Content if BullMQ job cannot be discarded (best-effort).
   */
  @Delete(':delegationId')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('delegationId') delegationId: string,
  ): Promise<DelegationDto> {
    return this.delegations.cancel(user.userId, projectId, delegationId)
  }
}
