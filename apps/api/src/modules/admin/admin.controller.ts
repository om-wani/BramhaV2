import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { AdminGuard } from '../common/guards/admin.guard'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator'
import {
  AdminService,
  type AdminUser,
  type AdminPersona,
  type AdminModelPolicy,
  type AdminConnector,
  type AdminGrant,
  type AdminTokenUsage,
  type QueueDepth,
  type AuditLogEntry,
} from './admin.service'

// ── Request DTOs ─────────────────────────────────────────────────────────────

const UpdatePersonaSchema = z.object({
  systemPromptTpl: z.string().min(1).optional(),
  speakProfile: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
})

const UpdateModelPolicySchema = z.object({
  primaryProvider: z.string().min(1).optional(),
  primaryModel: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxInputTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
})

const UpsertGrantSchema = z.object({
  projectId: z.string().uuid(),
  personaId: z.string().uuid(),
  connectorId: z.string().uuid(),
  allowedScopes: z.array(z.string()),
  requiresApproval: z.boolean(),
})

class UpdatePersonaDto extends createZodDto(UpdatePersonaSchema) {}
class UpdateModelPolicyDto extends createZodDto(UpdateModelPolicySchema) {}
class UpsertGrantDto extends createZodDto(UpsertGrantSchema) {}

// ── Controller ───────────────────────────────────────────────────────────────

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // ── Users ──────────────────────────────────────────────────────────────────

  /** GET /admin/users — List all users */
  @Get('users')
  listUsers(): Promise<AdminUser[]> {
    return this.admin.listUsers()
  }

  /** POST /admin/users/:userId/suspend — Suspend user */
  @Post('users/:userId/suspend')
  @HttpCode(HttpStatus.OK)
  suspendUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.admin.suspendUser(user.userId, userId)
  }

  /** POST /admin/users/:userId/unsuspend — Unsuspend user */
  @Post('users/:userId/unsuspend')
  @HttpCode(HttpStatus.OK)
  unsuspendUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.admin.unsuspendUser(user.userId, userId)
  }

  /** POST /admin/users/:userId/reset-2fa — Reset 2FA for user */
  @Post('users/:userId/reset-2fa')
  @HttpCode(HttpStatus.OK)
  resetTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.admin.resetTwoFactor(user.userId, userId)
  }

  // ── Personas ───────────────────────────────────────────────────────────────

  /** GET /admin/personas — List all personas */
  @Get('personas')
  listPersonas(): Promise<AdminPersona[]> {
    return this.admin.listPersonas()
  }

  /** GET /admin/personas/:personaId — Get single persona */
  @Get('personas/:personaId')
  getPersona(@Param('personaId') personaId: string): Promise<AdminPersona> {
    return this.admin.getPersona(personaId)
  }

  /** PATCH /admin/personas/:personaId — Update persona system prompt / speak profile */
  @Patch('personas/:personaId')
  updatePersona(
    @CurrentUser() user: AuthenticatedUser,
    @Param('personaId') personaId: string,
    @Body() body: UpdatePersonaDto,
  ): Promise<AdminPersona> {
    return this.admin.updatePersona(user.userId, personaId, {
      ...(body.systemPromptTpl !== undefined && { systemPromptTpl: body.systemPromptTpl }),
      ...(body.speakProfile    !== undefined && { speakProfile: body.speakProfile }),
      ...(body.enabled         !== undefined && { enabled: body.enabled }),
    })
  }

  // ── Model policies ─────────────────────────────────────────────────────────

  /** GET /admin/personas/:personaId/model-policy — Get model policy for persona */
  @Get('personas/:personaId/model-policy')
  getModelPolicy(
    @Param('personaId') personaId: string,
  ): Promise<AdminModelPolicy | null> {
    return this.admin.getModelPolicy(personaId)
  }

  /** PATCH /admin/personas/:personaId/model-policy — Update model policy */
  @Patch('personas/:personaId/model-policy')
  updateModelPolicy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('personaId') personaId: string,
    @Body() body: UpdateModelPolicyDto,
  ): Promise<AdminModelPolicy> {
    return this.admin.updateModelPolicy(user.userId, personaId, {
      ...(body.primaryProvider  !== undefined && { primaryProvider: body.primaryProvider }),
      ...(body.primaryModel     !== undefined && { primaryModel: body.primaryModel }),
      ...(body.temperature      !== undefined && { temperature: body.temperature }),
      ...(body.maxInputTokens   !== undefined && { maxInputTokens: body.maxInputTokens }),
      ...(body.maxOutputTokens  !== undefined && { maxOutputTokens: body.maxOutputTokens }),
    })
  }

  // ── MCP connectors ─────────────────────────────────────────────────────────

  /** GET /admin/mcp/connectors — List all connectors */
  @Get('mcp/connectors')
  listConnectors(): Promise<AdminConnector[]> {
    return this.admin.listConnectors()
  }

  /** GET /admin/mcp/grants — List all grants */
  @Get('mcp/grants')
  listGrants(): Promise<AdminGrant[]> {
    return this.admin.listGrants()
  }

  /** POST /admin/mcp/grants — Create or update a grant */
  @Post('mcp/grants')
  @HttpCode(HttpStatus.OK)
  upsertGrant(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpsertGrantDto,
  ): Promise<AdminGrant> {
    return this.admin.upsertGrant(user.userId, body)
  }

  /** DELETE /admin/mcp/grants/:grantId — Remove a grant */
  @Delete('mcp/grants/:grantId')
  @HttpCode(HttpStatus.OK)
  async deleteGrant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('grantId') grantId: string,
  ): Promise<{ success: boolean }> {
    await this.admin.deleteGrant(user.userId, grantId)
    return { success: true }
  }

  // ── Diagnostics ────────────────────────────────────────────────────────────

  /** GET /admin/diagnostics/token-usage — Token spend last 30 days */
  @Get('diagnostics/token-usage')
  getTokenUsage(): Promise<AdminTokenUsage[]> {
    return this.admin.getTokenUsage()
  }

  /** GET /admin/diagnostics/queue-depths — BullMQ queue job counts */
  @Get('diagnostics/queue-depths')
  getQueueDepths(): Promise<Record<string, QueueDepth>> {
    return this.admin.getQueueDepths()
  }

  // ── Audit log ──────────────────────────────────────────────────────────────

  /** GET /admin/audit-log — Search audit log */
  @Get('audit-log')
  searchAuditLog(
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ): Promise<AuditLogEntry[]> {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : 50
    return this.admin.searchAuditLog({
      ...(actorId   !== undefined && { actorId }),
      ...(action    !== undefined && { action }),
      ...(projectId !== undefined && { projectId }),
      ...(from      !== undefined && { from }),
      ...(to        !== undefined && { to }),
      limit: parsedLimit,
    })
  }
}
