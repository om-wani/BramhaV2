/**
 * ApprovalsController — REST API for MCP tool-call approval gates.
 *
 * Endpoints:
 *   POST /projects/:projectId/approvals                          — create approval
 *   GET  /projects/:projectId/approvals/:approvalId             — get approval
 *   POST /projects/:projectId/approvals/:approvalId/decide      — approve or deny
 *
 * Guards: JwtAuthGuard + ProjectMemberGuard (viewer) on all endpoints.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator'
import { ProjectViewerGuard } from '../common/guards/project-member.guard'
import {
  ApprovalsService,
  type ApprovalDto,
  type CreateApprovalInput,
  type DecideApprovalInput,
} from './approvals.service'

@Controller('projects/:projectId/approvals')
@UseGuards(JwtAuthGuard, ProjectViewerGuard)
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /**
   * POST /projects/:projectId/approvals
   * Create a pending approval for a write/execute MCP tool call.
   *
   * Body: { personaId, delegationId?, toolName, connectorId, argsHash }
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  createApproval(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() body: CreateApprovalInput,
  ): Promise<ApprovalDto> {
    return this.approvals.createApproval(user.userId, projectId, body)
  }

  /**
   * GET /projects/:projectId/approvals/:approvalId
   * Get a single approval by ID.
   */
  @Get(':approvalId')
  getApproval(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('approvalId') approvalId: string,
  ): Promise<ApprovalDto> {
    return this.approvals.getApproval(user.userId, projectId, approvalId)
  }

  /**
   * POST /projects/:projectId/approvals/:approvalId/decide
   * Approve or deny a pending approval.
   *
   * Body: { decision: 'approved' | 'denied', argsHash: string }
   * The argsHash is verified against the stored payload_hash (tamper check).
   */
  @Post(':approvalId/decide')
  @HttpCode(HttpStatus.OK)
  decideApproval(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('approvalId') approvalId: string,
    @Body() body: DecideApprovalInput,
  ): Promise<ApprovalDto> {
    return this.approvals.decideApproval(user.userId, projectId, approvalId, body)
  }
}
