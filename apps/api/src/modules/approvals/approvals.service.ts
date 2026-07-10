/**
 * ApprovalsService — DB queries for MCP tool-call approval flow.
 *
 * Approvals represent pending human approval gates for MCP write/execute calls.
 * The payload_hash (argsHash) is stored at creation time and verified at decide
 * time to prevent tampered-args attacks.
 *
 * Events emitted (fire-and-forget):
 *   approval.requested:{projectId}
 *   approval.decided:{projectId}
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common'
import { RlsDbService } from '../common/db/rls-db.service'
import { EventPublisher } from '@bramha/event-bus'
import { REDIS_CLIENT } from '../common/redis/redis.module'
import type Redis from 'ioredis'

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface ApprovalDto {
  id: string
  projectId: string
  requestedByPersona: string
  delegationId: string | null
  actionSummary: string
  payloadHash: string
  status: string
  decidedBy: string | null
  decidedAt: string | null
  expiresAt: string
  createdAt: string
}

export interface CreateApprovalInput {
  personaId: string
  delegationId?: string | null
  toolName: string
  connectorId: string
  argsHash: string
}

export interface DecideApprovalInput {
  decision: 'approved' | 'denied'
  /** Must match the stored payload_hash to prevent tamper attacks */
  argsHash: string
}

// ── DB row shape ───────────────────────────────────────────────────────────────

interface ApprovalRow {
  id: string
  project_id: string
  requested_by_persona: string
  delegation_id: string | null
  action_summary: string
  payload_hash: string
  status: string
  decided_by: string | null
  decided_at: string | null
  expires_at: string
  created_at: string
}

function toDto(row: ApprovalRow): ApprovalDto {
  return {
    id: row.id,
    projectId: row.project_id,
    requestedByPersona: row.requested_by_persona,
    delegationId: row.delegation_id,
    actionSummary: row.action_summary,
    payloadHash: row.payload_hash,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class ApprovalsService {
  private readonly publisher: EventPublisher

  constructor(
    private readonly db: RlsDbService,
    @Inject(REDIS_CLIENT) redis: Redis,
  ) {
    this.publisher = new EventPublisher(redis)
  }

  /**
   * Create a new pending approval.
   * action_summary stores "{connectorId}:{toolName}" for human readability.
   * payload_hash stores argsHash for tamper detection at decide time.
   * expires_at defaults to 24 hours from creation.
   */
  async createApproval(
    userId: string,
    projectId: string,
    input: CreateApprovalInput,
  ): Promise<ApprovalDto> {
    const actionSummary = `${input.connectorId}:${input.toolName}`

    const row = await this.db.run({ userId, projectId }, async (tx) => {
      const [r] = await tx<ApprovalRow[]>`
        INSERT INTO approvals (
          project_id,
          requested_by_persona,
          delegation_id,
          action_summary,
          payload_hash,
          expires_at
        )
        VALUES (
          ${projectId}::uuid,
          ${input.personaId}::uuid,
          ${input.delegationId ?? null}::uuid,
          ${actionSummary},
          ${input.argsHash},
          NOW() + INTERVAL '24 hours'
        )
        RETURNING
          id, project_id, requested_by_persona, delegation_id,
          action_summary, payload_hash, status, decided_by,
          decided_at::text AS decided_at,
          expires_at::text AS expires_at,
          created_at::text AS created_at
      `
      return r!
    })

    // Emit event (fire-and-forget)
    this.publisher
      .publish(`approval.requested:${projectId}`, {
        approvalId: row.id,
        projectId,
        connectorId: input.connectorId,
        toolName: input.toolName,
        personaId: input.personaId,
      })
      .catch(() => {
        // EventPublisher may throw for unknown channels — fall through
      })

    return toDto(row)
  }

  /** Get a single approval by ID. Throws NotFoundException if not found. */
  async getApproval(
    userId: string,
    projectId: string,
    approvalId: string,
  ): Promise<ApprovalDto> {
    const row = await this.db.run({ userId, projectId }, async (tx) => {
      const [r] = await tx<ApprovalRow[]>`
        SELECT
          id, project_id, requested_by_persona, delegation_id,
          action_summary, payload_hash, status, decided_by,
          decided_at::text AS decided_at,
          expires_at::text AS expires_at,
          created_at::text AS created_at
        FROM approvals
        WHERE id = ${approvalId}::uuid
          AND project_id = ${projectId}::uuid
        LIMIT 1
      `
      return r ?? null
    })

    if (!row) {
      throw new NotFoundException({ code: 'not_found', resource: 'approval' })
    }

    return toDto(row)
  }

  /**
   * Decide an approval (approve or deny).
   *
   * Security: verifies argsHash against stored payload_hash before updating.
   * A mismatch means the caller's args differ from what was originally requested
   * — reject as a tamper attempt (400).
   */
  async decideApproval(
    userId: string,
    projectId: string,
    approvalId: string,
    input: DecideApprovalInput,
  ): Promise<ApprovalDto> {
    const updated = await this.db.run({ userId, projectId }, async (tx) => {
      // Fetch existing approval
      const [existing] = await tx<Array<{ status: string; payload_hash: string }>>`
        SELECT status, payload_hash
        FROM approvals
        WHERE id = ${approvalId}::uuid
          AND project_id = ${projectId}::uuid
        LIMIT 1
      `

      if (!existing) {
        throw new NotFoundException({ code: 'not_found', resource: 'approval' })
      }

      // Tamper check: argsHash must match stored payload_hash
      if (existing.payload_hash !== input.argsHash) {
        throw new BadRequestException({
          code: 'tamper_detected',
          message: 'argsHash does not match stored payload hash',
        })
      }

      if (existing.status !== 'pending') {
        throw new BadRequestException({
          code: 'invalid_state',
          message: `Cannot decide approval in status '${existing.status}'`,
        })
      }

      const [row] = await tx<ApprovalRow[]>`
        UPDATE approvals
        SET
          status     = ${input.decision},
          decided_by = ${userId}::uuid,
          decided_at = NOW()
        WHERE id = ${approvalId}::uuid
          AND project_id = ${projectId}::uuid
        RETURNING
          id, project_id, requested_by_persona, delegation_id,
          action_summary, payload_hash, status, decided_by,
          decided_at::text AS decided_at,
          expires_at::text AS expires_at,
          created_at::text AS created_at
      `

      return row!
    })

    // Emit event (fire-and-forget)
    this.publisher
      .publish(`approval.decided:${projectId}`, {
        approvalId,
        projectId,
        decision: input.decision,
      })
      .catch(() => {
        // EventPublisher may throw for unknown channels — fall through
      })

    return toDto(updated)
  }
}
