import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common'
import { withAdmin } from '@bramha/db'
import type postgres from 'postgres'
import { Queue } from 'bullmq'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '../common/redis/redis.module'

// ── Row types ─────────────────────────────────────────────────────────────────

interface UserRow {
  id: string
  email: string
  display_name: string
  is_admin: boolean
  status: string
  totp_secret_enc: Buffer | null
  created_at: string
}

interface PersonaRow {
  id: string
  scope: string
  tier: string
  slug: string
  name: string
  title: string | null
  color: string | null
  system_prompt_tpl: string
  speak_profile: Record<string, unknown>
  enabled: boolean
}

interface ModelPolicyRow {
  id: string
  persona_id: string
  tier: string
  primary_provider: string
  primary_model: string
  fallbacks: unknown
  max_input_tokens: number
  max_output_tokens: number
  temperature: number
  per_turn_usd: string
  per_day_usd: string
  prompt_caching: boolean
}

interface ConnectorRow {
  id: string
  project_id: string | null
  name: string
  slug: string
  manifest: unknown
  enabled: boolean
  created_at: string
}

interface GrantRow {
  id: string
  project_id: string
  persona_id: string
  connector_id: string
  allowed_scopes: string[]
  requires_approval: boolean
  expires_at: string | null
  created_at: string
}

interface TokenUsageRow {
  project_id: string
  persona_id: string | null
  model: string
  day: string
  input_tokens: string
  output_tokens: string
  cost_usd: string
}

interface AuditLogRow {
  id: string
  actor_id: string | null
  action: string
  target_type: string
  target_id: string
  project_id: string | null
  payload: Record<string, unknown>
  created_at: string
}

// ── DTO types ────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string
  email: string
  displayName: string
  isAdmin: boolean
  isSuspended: boolean
  totpEnabled: boolean
  createdAt: string
}

export interface AdminPersona {
  id: string
  scope: string
  tier: string
  slug: string
  name: string
  title: string | null
  color: string | null
  systemPromptTpl: string
  speakProfile: Record<string, unknown>
  enabled: boolean
}

export interface AdminModelPolicy {
  id: string
  personaId: string
  tier: string
  primaryProvider: string
  primaryModel: string
  fallbacks: unknown
  maxInputTokens: number
  maxOutputTokens: number
  temperature: number
  perTurnUsd: string
  perDayUsd: string
  promptCaching: boolean
}

export interface AdminConnector {
  id: string
  projectId: string | null
  name: string
  slug: string
  manifest: unknown
  enabled: boolean
  createdAt: string
}

export interface AdminGrant {
  id: string
  projectId: string
  personaId: string
  connectorId: string
  allowedScopes: string[]
  requiresApproval: boolean
  expiresAt: string | null
  createdAt: string
}

export interface AdminTokenUsage {
  projectId: string
  personaId: string | null
  model: string
  day: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface QueueDepth {
  waiting: number
  active: number
  delayed: number
  failed: number
}

export interface AuditLogEntry {
  id: string
  actorId: string | null
  action: string
  targetType: string
  targetId: string
  projectId: string | null
  payload: Record<string, unknown>
  createdAt: string
}

export interface UpdatePersonaInput {
  systemPromptTpl?: string | undefined
  speakProfile?: Record<string, unknown> | undefined
  enabled?: boolean | undefined
}

export interface UpdateModelPolicyInput {
  primaryProvider?: string | undefined
  primaryModel?: string | undefined
  temperature?: number | undefined
  maxInputTokens?: number | undefined
  maxOutputTokens?: number | undefined
}

export interface UpsertGrantInput {
  projectId: string
  personaId: string
  connectorId: string
  allowedScopes: string[]
  requiresApproval: boolean
}

export interface AuditLogParams {
  actorId?: string | undefined
  action?: string | undefined
  projectId?: string | undefined
  from?: string | undefined
  to?: string | undefined
  limit?: number | undefined
}

// ── Mappers ──────────────────────────────────────────────────────────────────

function mapUser(r: UserRow): AdminUser {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    isAdmin: r.is_admin,
    isSuspended: r.status === 'suspended',
    totpEnabled: r.totp_secret_enc !== null,
    createdAt: r.created_at,
  }
}

function mapPersona(r: PersonaRow): AdminPersona {
  return {
    id: r.id,
    scope: r.scope,
    tier: r.tier,
    slug: r.slug,
    name: r.name,
    title: r.title,
    color: r.color,
    systemPromptTpl: r.system_prompt_tpl,
    speakProfile: r.speak_profile,
    enabled: r.enabled,
  }
}

function mapPolicy(r: ModelPolicyRow): AdminModelPolicy {
  return {
    id: r.id,
    personaId: r.persona_id,
    tier: r.tier,
    primaryProvider: r.primary_provider,
    primaryModel: r.primary_model,
    fallbacks: r.fallbacks,
    maxInputTokens: r.max_input_tokens,
    maxOutputTokens: r.max_output_tokens,
    temperature: r.temperature,
    perTurnUsd: r.per_turn_usd,
    perDayUsd: r.per_day_usd,
    promptCaching: r.prompt_caching,
  }
}

function mapConnector(r: ConnectorRow): AdminConnector {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    slug: r.slug,
    manifest: r.manifest,
    enabled: r.enabled,
    createdAt: r.created_at,
  }
}

function mapGrant(r: GrantRow): AdminGrant {
  return {
    id: r.id,
    projectId: r.project_id,
    personaId: r.persona_id,
    connectorId: r.connector_id,
    allowedScopes: r.allowed_scopes,
    requiresApproval: r.requires_approval,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }
}

function mapTokenUsage(r: TokenUsageRow): AdminTokenUsage {
  return {
    projectId: r.project_id,
    personaId: r.persona_id,
    model: r.model,
    day: r.day,
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    costUsd: Number(r.cost_usd),
  }
}

function mapAuditLog(r: AuditLogRow): AuditLogEntry {
  return {
    id: r.id,
    actorId: r.actor_id,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    projectId: r.project_id,
    payload: r.payload,
    createdAt: r.created_at,
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name)
  private readonly knownQueues = ['ingestion', 'embedding']

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ── DB helper (protected so tests can spy/override) ──────────────────────

  protected async adminRun<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return withAdmin(fn)
  }

  // ── Audit log ─────────────────────────────────────────────────────────────

  async auditLog(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    projectId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.adminRun(async (tx) => {
        const payloadJson = JSON.stringify(payload)
        await tx`
          INSERT INTO audit_log (actor_id, action, target_type, target_id, project_id, payload)
          VALUES (${actorId}, ${action}, ${targetType}, ${targetId}, ${projectId}, ${payloadJson}::jsonb)
        `
      })
    } catch (err) {
      this.logger.error({ event: 'audit_log.insert_failed', action, targetType, targetId }, String(err))
    }
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  async listUsers(): Promise<AdminUser[]> {
    try {
      const rows = await this.adminRun(async (tx) => {
        return tx<UserRow[]>`
          SELECT id, email, display_name, is_admin, status, totp_secret_enc, created_at
          FROM   users
          ORDER  BY created_at DESC
        `
      })
      return rows.map(mapUser)
    } catch (err) {
      this.logger.error({ event: 'admin.list_users.failed' }, String(err))
      throw new InternalServerErrorException({ code: 'internal_error' })
    }
  }

  async suspendUser(actorId: string, userId: string): Promise<void> {
    try {
      await this.adminRun(async (tx) => {
        const rows = await tx<{ id: string }[]>`
          UPDATE users
          SET    status = 'suspended', updated_at = now()
          WHERE  id = ${userId}
          RETURNING id
        `
        if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      })
      await this.auditLog(actorId, 'admin.user.suspend', 'user', userId, null, {})
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error({ event: 'admin.suspend_user.failed', userId }, String(err))
      throw new InternalServerErrorException({ code: 'internal_error' })
    }
  }

  async unsuspendUser(actorId: string, userId: string): Promise<void> {
    try {
      await this.adminRun(async (tx) => {
        const rows = await tx<{ id: string }[]>`
          UPDATE users
          SET    status = 'active', updated_at = now()
          WHERE  id = ${userId}
          RETURNING id
        `
        if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      })
      await this.auditLog(actorId, 'admin.user.unsuspend', 'user', userId, null, {})
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error({ event: 'admin.unsuspend_user.failed', userId }, String(err))
      throw new InternalServerErrorException({ code: 'internal_error' })
    }
  }

  async resetTwoFactor(actorId: string, userId: string): Promise<void> {
    try {
      await this.adminRun(async (tx) => {
        // Clear TOTP secret
        const rows = await tx<{ id: string }[]>`
          UPDATE users
          SET    totp_secret_enc = NULL, updated_at = now()
          WHERE  id = ${userId}
          RETURNING id
        `
        if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
        // Delete all recovery codes
        await tx`
          DELETE FROM recovery_codes
          WHERE  user_id = ${userId}
        `
      })
      await this.auditLog(actorId, 'admin.user.reset_2fa', 'user', userId, null, {})
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error({ event: 'admin.reset_2fa.failed', userId }, String(err))
      throw new InternalServerErrorException({ code: 'internal_error' })
    }
  }

  // ── Personas ──────────────────────────────────────────────────────────────

  async listPersonas(): Promise<AdminPersona[]> {
    try {
      const rows = await this.adminRun(async (tx) => {
        return tx<PersonaRow[]>`
          SELECT id, scope, tier, slug, name, title, color,
                 system_prompt_tpl, speak_profile, enabled
          FROM   agent_personas
          ORDER  BY tier, slug
        `
      })
      return rows.map(mapPersona)
    } catch (err) {
      this.logger.error({ event: 'admin.list_personas.failed' }, String(err))
      throw new InternalServerErrorException({ code: 'internal_error' })
    }
  }

  async updatePersona(
    actorId: string,
    personaId: string,
    input: UpdatePersonaInput,
  ): Promise<AdminPersona> {
    try {
      const row = await this.adminRun(async (tx) => {
        const current = await tx<PersonaRow[]>`
          SELECT id, scope, tier, slug, name, title, color,
                 system_prompt_tpl, speak_profile, enabled
          FROM   agent_personas
          WHERE  id = ${personaId}
        `
        if (!current[0]) throw new NotFoundException({ code: 'not_found' })

        const newPrompt      = input.systemPromptTpl ?? current[0].system_prompt_tpl
        const newSpeakProfile =
          input.speakProfile !== undefined
            ? input.speakProfile
            : current[0].speak_profile
        const newEnabled     = input.enabled !== undefined ? input.enabled : current[0].enabled

        const speakProfileJson = JSON.stringify(newSpeakProfile)
        const updated = await tx<PersonaRow[]>`
          UPDATE agent_personas
          SET    system_prompt_tpl = ${newPrompt},
                 speak_profile     = ${speakProfileJson}::jsonb,
                 enabled           = ${newEnabled}
          WHERE  id = ${personaId}
          RETURNING id, scope, tier, slug, name, title, color,
                    system_prompt_tpl, speak_profile, enabled
        `
        return updated[0]!
      })
      await this.auditLog(actorId, 'admin.persona.update', 'persona', personaId, null, {
        systemPromptChanged: input.systemPromptTpl !== undefined,
        speakProfileChanged: input.speakProfile !== undefined,
        enabledChanged: input.enabled !== undefined,
      })
      return mapPersona(row)
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error({ event: 'admin.update_persona.failed', personaId }, String(err))
      throw new InternalServerErrorException({ code: 'internal_error' })
    }
  }

  // ── Model policies ────────────────────────────────────────────────────────

  async getModelPolicy(personaId: string): Promise<AdminModelPolicy | null> {
    try {
      const rows = await this.adminRun(async (tx) => {
        return tx<ModelPolicyRow[]>`
          SELECT id, persona_id, tier, primary_provider, primary_model, fallbacks,
                 max_input_tokens, max_output_tokens, temperature,
                 per_turn_usd, per_day_usd, prompt_caching
          FROM   agent_model_policies
          WHERE  persona_id = ${personaId}
        `
      })
      return rows[0] ? mapPolicy(rows[0]) : null
    } catch (err) {
      this.logger.error({ event: 'admin.get_model_policy.failed', personaId }, String(err))
      throw new InternalServerErrorException({ code: 'internal_error' })
    }
  }

  async updateModelPolicy(
    actorId: string,
    personaId: string,
    input: UpdateModelPolicyInput,
  ): Promise<AdminModelPolicy> {
    try {
      const row = await this.adminRun(async (tx) => {
        const current = await tx<ModelPolicyRow[]>`
          SELECT id, persona_id, tier, primary_provider, primary_model, fallbacks,
                 max_input_tokens, max_output_tokens, temperature,
                 per_turn_usd, per_day_usd, prompt_caching
          FROM   agent_model_policies
          WHERE  persona_id = ${personaId}
        `
        if (!current[0]) throw new NotFoundException({ code: 'not_found' })

        const c = current[0]
        const updated = await tx<ModelPolicyRow[]>`
          UPDATE agent_model_policies
          SET    primary_provider  = ${input.primaryProvider  ?? c.primary_provider},
                 primary_model     = ${input.primaryModel     ?? c.primary_model},
                 temperature       = ${input.temperature      ?? c.temperature},
                 max_input_tokens  = ${input.maxInputTokens   ?? c.max_input_tokens},
                 max_output_tokens = ${input.maxOutputTokens  ?? c.max_output_tokens}
          WHERE  persona_id = ${personaId}
          RETURNING id, persona_id, tier, primary_provider, primary_model, fallbacks,
                    max_input_tokens, max_output_tokens, temperature,
                    per_turn_usd, per_day_usd, prompt_caching
        `
        return updated[0]!
      })
      await this.auditLog(actorId, 'admin.model_policy.update', 'model_policy', personaId, null, {
        primaryProvider:  input.primaryProvider,
        primaryModel:     input.primaryModel,
        temperature:      input.temperature,
        maxInputTokens:   input.maxInputTokens,
        maxOutputTokens:  input.maxOutputTokens,
      })
      return mapPolicy(row)
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error({ event: 'admin.update_model_policy.failed', personaId }, String(err))
      throw new InternalServerErrorException({ code: 'internal_error' })
    }
  }

  // ── MCP Connectors ────────────────────────────────────────────────────────

  async listConnectors(): Promise<AdminConnector[]> {
    try {
      const rows = await this.adminRun(async (tx) => {
        return tx<ConnectorRow[]>`
          SELECT id, project_id, name, slug, manifest, enabled, created_at
          FROM   mcp_connectors
          ORDER  BY name
        `
      })
      return rows.map(mapConnector)
    } catch (err) {
      this.logger.error({ event: 'admin.list_connectors.failed' }, String(err))
      throw new InternalServerErrorException({ code: 'internal_error' })
    }
  }

  // ── MCP Grants ────────────────────────────────────────────────────────────

  async listGrants(): Promise<AdminGrant[]> {
    try {
      const rows = await this.adminRun(async (tx) => {
        return tx<GrantRow[]>`
          SELECT id, project_id, persona_id, connector_id,
                 allowed_scopes, requires_approval, expires_at, created_at
          FROM   mcp_grants
          ORDER  BY created_at DESC
        `
      })
      return rows.map(mapGrant)
    } catch (err) {
      this.logger.error({ event: 'admin.list_grants.failed' }, String(err))
      throw new InternalServerErrorException({ code: 'internal_error' })
    }
  }

  async upsertGrant(actorId: string, input: UpsertGrantInput): Promise<AdminGrant> {
    try {
      const row = await this.adminRun(async (tx) => {
        const rows = await tx<GrantRow[]>`
          INSERT INTO mcp_grants
            (project_id, persona_id, connector_id, allowed_scopes, requires_approval)
          VALUES
            (${input.projectId}, ${input.personaId}, ${input.connectorId},
             ${input.allowedScopes}, ${input.requiresApproval})
          ON CONFLICT (project_id, persona_id, connector_id) DO UPDATE
            SET allowed_scopes   = EXCLUDED.allowed_scopes,
                requires_approval = EXCLUDED.requires_approval
          RETURNING id, project_id, persona_id, connector_id,
                    allowed_scopes, requires_approval, expires_at, created_at
        `
        return rows[0]!
      })
      await this.auditLog(actorId, 'admin.mcp_grant.upsert', 'mcp_grant', row.id, input.projectId, {
        personaId:        input.personaId,
        connectorId:      input.connectorId,
        allowedScopes:    input.allowedScopes,
        requiresApproval: input.requiresApproval,
      })
      return mapGrant(row)
    } catch (err) {
      this.logger.error({ event: 'admin.upsert_grant.failed' }, String(err))
      throw new InternalServerErrorException({ code: 'internal_error' })
    }
  }

  async deleteGrant(actorId: string, grantId: string): Promise<void> {
    try {
      await this.adminRun(async (tx) => {
        const rows = await tx<{ id: string; project_id: string }[]>`
          DELETE FROM mcp_grants
          WHERE  id = ${grantId}
          RETURNING id, project_id
        `
        if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
        await this.auditLog(
          actorId,
          'admin.mcp_grant.delete',
          'mcp_grant',
          grantId,
          rows[0].project_id,
          {},
        )
      })
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error({ event: 'admin.delete_grant.failed', grantId }, String(err))
      throw new InternalServerErrorException({ code: 'internal_error' })
    }
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  async getTokenUsage(): Promise<AdminTokenUsage[]> {
    try {
      const rows = await this.adminRun(async (tx) => {
        return tx<TokenUsageRow[]>`
          SELECT project_id, persona_id, model, day,
                 input_tokens, output_tokens, cost_usd
          FROM   token_usage_daily
          WHERE  day >= NOW() - INTERVAL '30 days'
          ORDER  BY day DESC, cost_usd DESC
        `
      })
      return rows.map(mapTokenUsage)
    } catch (err) {
      this.logger.error({ event: 'admin.token_usage.failed' }, String(err))
      throw new InternalServerErrorException({ code: 'internal_error' })
    }
  }

  async getQueueDepths(): Promise<Record<string, QueueDepth>> {
    const result: Record<string, QueueDepth> = {}
    for (const name of this.knownQueues) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q = new Queue(name, { connection: this.redis as any })
        const [waiting, active, delayed, failed] = await Promise.all([
          q.getWaitingCount(),
          q.getActiveCount(),
          q.getDelayedCount(),
          q.getFailedCount(),
        ])
        await q.close()
        result[name] = { waiting, active, delayed, failed }
      } catch {
        result[name] = { waiting: -1, active: -1, delayed: -1, failed: -1 }
      }
    }
    return result
  }

  // ── Audit log search ──────────────────────────────────────────────────────

  async searchAuditLog(params: AuditLogParams): Promise<AuditLogEntry[]> {
    const { actorId, action, projectId, from, to, limit = 50 } = params
    try {
      const rows = await this.adminRun(async (tx) => {
        return tx<AuditLogRow[]>`
          SELECT id, actor_id, action, target_type, target_id,
                 project_id, payload, created_at
          FROM   audit_log
          WHERE  (${actorId ?? null}::uuid IS NULL OR actor_id = ${actorId ?? null}::uuid)
            AND  (${action ?? null} IS NULL       OR action    = ${action ?? null})
            AND  (${projectId ?? null}::uuid IS NULL OR project_id = ${projectId ?? null}::uuid)
            AND  (${from ?? null} IS NULL         OR created_at >= ${from ?? null}::timestamptz)
            AND  (${to ?? null} IS NULL           OR created_at <= ${to ?? null}::timestamptz)
          ORDER  BY created_at DESC
          LIMIT  ${Math.min(limit, 200)}
        `
      })
      return rows.map(mapAuditLog)
    } catch (err) {
      this.logger.error({ event: 'admin.search_audit_log.failed' }, String(err))
      throw new InternalServerErrorException({ code: 'internal_error' })
    }
  }
}
