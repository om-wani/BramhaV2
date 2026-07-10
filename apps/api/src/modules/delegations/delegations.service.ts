/**
 * DelegationsService — DB queries for the delegations API.
 *
 * All queries run via RlsDbService (wraps withTenant, enforces RLS).
 * Cancel: sets status='cancelled', emits delegation.cancelled event.
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

export interface DelegationDto {
  id: string
  projectId: string
  groupId: string
  parentPersonaId: string | null
  workerPersonaId: string | null
  originNodeId: string | null
  spec: Record<string, unknown>
  budget: Record<string, unknown>
  status: string
  result: Record<string, unknown> | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export interface ListDelegationsResult {
  items: DelegationDto[]
  total: number
  limit: number
  offset: number
}

// ── DB row shape ───────────────────────────────────────────────────────────────

interface DelegationRow {
  id: string
  project_id: string
  group_id: string
  parent_persona_id: string | null
  worker_persona_id: string | null
  origin_node_id: string | null
  spec: Record<string, unknown>
  budget: Record<string, unknown>
  status: string
  result: Record<string, unknown> | null
  started_at: string | null
  finished_at: string | null
  created_at: string
}

function toDto(row: DelegationRow): DelegationDto {
  return {
    id: row.id,
    projectId: row.project_id,
    groupId: row.group_id,
    parentPersonaId: row.parent_persona_id,
    workerPersonaId: row.worker_persona_id,
    originNodeId: row.origin_node_id,
    spec: row.spec,
    budget: row.budget,
    status: row.status,
    result: row.result,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

/** Cancellable statuses — cannot cancel completed/failed/timeout delegations. */
const CANCELLABLE_STATUSES = new Set(['queued', 'running', 'waiting_approval'])

@Injectable()
export class DelegationsService {
  private readonly publisher: EventPublisher

  constructor(
    private readonly db: RlsDbService,
    @Inject(REDIS_CLIENT) redis: Redis,
  ) {
    this.publisher = new EventPublisher(redis)
  }

  /** List delegations for a project, paginated, filterable by status. */
  async list(
    userId: string,
    projectId: string,
    opts: { status?: string; limit?: number; offset?: number },
  ): Promise<ListDelegationsResult> {
    const limit = Math.min(opts.limit ?? 20, 100)
    const offset = opts.offset ?? 0

    return this.db.run({ userId, projectId }, async (tx) => {
      const whereStatus = opts.status
        ? tx`AND status = ${opts.status}`
        : tx``

      const rows = await tx<DelegationRow[]>`
        SELECT id, project_id, group_id, parent_persona_id, worker_persona_id,
               origin_node_id, spec, budget, status, result,
               started_at::text AS started_at,
               finished_at::text AS finished_at,
               created_at::text AS created_at
        FROM delegations
        WHERE project_id = ${projectId}::uuid
          ${whereStatus}
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `

      const [countRow] = await tx<Array<{ total: string }>>`
        SELECT COUNT(*)::text AS total
        FROM delegations
        WHERE project_id = ${projectId}::uuid
          ${whereStatus}
      `

      return {
        items: rows.map(toDto),
        total: parseInt(countRow?.total ?? '0'),
        limit,
        offset,
      }
    })
  }

  /** Get a single delegation by ID. Throws NotFoundException if not found. */
  async getById(
    userId: string,
    projectId: string,
    delegationId: string,
  ): Promise<DelegationDto> {
    const row = await this.db.run({ userId, projectId }, async (tx) => {
      const [r] = await tx<DelegationRow[]>`
        SELECT id, project_id, group_id, parent_persona_id, worker_persona_id,
               origin_node_id, spec, budget, status, result,
               started_at::text AS started_at,
               finished_at::text AS finished_at,
               created_at::text AS created_at
        FROM delegations
        WHERE id = ${delegationId}::uuid
          AND project_id = ${projectId}::uuid
        LIMIT 1
      `
      return r ?? null
    })

    if (!row) {
      throw new NotFoundException({ code: 'not_found', resource: 'delegation' })
    }

    return toDto(row)
  }

  /**
   * Cancel a delegation.
   *
   * Sets status='cancelled' and emits delegation.cancelled:{projectId}.
   * Throws BadRequestException if the delegation is in a non-cancellable status.
   * Throws NotFoundException if the delegation does not belong to the project.
   */
  async cancel(
    userId: string,
    projectId: string,
    delegationId: string,
  ): Promise<DelegationDto> {
    const updated = await this.db.run({ userId, projectId }, async (tx) => {
      const [existing] = await tx<Array<{ status: string }>>`
        SELECT status FROM delegations
        WHERE id = ${delegationId}::uuid
          AND project_id = ${projectId}::uuid
        LIMIT 1
      `

      if (!existing) {
        throw new NotFoundException({ code: 'not_found', resource: 'delegation' })
      }

      if (!CANCELLABLE_STATUSES.has(existing.status)) {
        throw new BadRequestException({
          code: 'invalid_state',
          message: `Cannot cancel delegation in status '${existing.status}'`,
        })
      }

      const [row] = await tx<DelegationRow[]>`
        UPDATE delegations
        SET status = 'cancelled',
            finished_at = NOW()
        WHERE id = ${delegationId}::uuid
          AND project_id = ${projectId}::uuid
        RETURNING
          id, project_id, group_id, parent_persona_id, worker_persona_id,
          origin_node_id, spec, budget, status, result,
          started_at::text AS started_at,
          finished_at::text AS finished_at,
          created_at::text AS created_at
      `

      return row!
    })

    // Emit cancellation event (fire-and-forget; ignore schema-validation errors)
    this.publisher
      .publish(`delegation.cancelled:${projectId}`, {
        delegationId,
        projectId,
      })
      .catch(async () => {
        // EventPublisher may throw for unknown channels — fall through
      })

    return toDto(updated)
  }
}
