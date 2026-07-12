import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common'
import { RlsDbService } from '../common/db/rls-db.service.js'
import { EventRelayService } from '../realtime/event-relay.service.js'
import type { CreateRoomInput, UpdateRoomInput, AddParticipantInput } from '@bramha/shared'

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface RoomDto {
  id: string
  projectId: string
  type: string
  name: string
  seedPrompt: string | null
  createdBy: string | null
  archivedAt: string | null
  /** When true, facts learned in this room are excluded from other rooms' context bundles. */
  isConfidential: boolean
  createdAt: string
  updatedAt: string
}

export interface ParticipantDto {
  id: string
  roomId: string
  participantKind: string
  userId: string | null
  personaId: string | null
  createdAt: string
}

export interface HiredPersonaDto {
  personaId: string
  name: string
  slug: string
  role: string | null
  accentColor: string | null
  /** Raw S3 key (not a URL). Consumers must check for `http` prefix before treating as image URL. */
  avatarKey: string | null
  hiredAt: string
}

export interface TokenUsageDto {
  id: string
  personaId: string | null
  conversationNodeId: string | null
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  estimatedUsd: string
  createdAt: string
  roomType: string | null
}

// ── Row types ─────────────────────────────────────────────────────────────────

interface RoomRow {
  id: string
  project_id: string
  type: string
  name: string
  seed_prompt: string | null
  created_by: string | null
  archived_at: string | null
  is_confidential: boolean
  created_at: string
  updated_at: string
}

interface ParticipantRow {
  id: string
  room_id: string
  participant_kind: string
  user_id: string | null
  persona_id: string | null
  created_at: string
}

interface HiredPersonaRow {
  persona_id: string
  name: string
  slug: string
  title: string | null
  color: string | null
  avatar_key: string | null
  hired_at: string
}

interface TokenUsageRow {
  id: string
  persona_id: string | null
  conversation_node_id: string | null
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  estimated_usd: string
  created_at: string
  room_type: string | null
}

function mapRoom(r: RoomRow): RoomDto {
  return {
    id: r.id,
    projectId: r.project_id,
    type: r.type,
    name: r.name,
    seedPrompt: r.seed_prompt,
    createdBy: r.created_by,
    archivedAt: r.archived_at,
    isConfidential: r.is_confidential,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function mapParticipant(r: ParticipantRow): ParticipantDto {
  return {
    id: r.id,
    roomId: r.room_id,
    participantKind: r.participant_kind,
    userId: r.user_id,
    personaId: r.persona_id,
    createdAt: r.created_at,
  }
}

function mapHiredPersona(r: HiredPersonaRow): HiredPersonaDto {
  return {
    personaId: r.persona_id,
    name: r.name,
    slug: r.slug,
    role: r.title,
    accentColor: r.color,
    avatarKey: r.avatar_key,
    hiredAt: r.hired_at,
  }
}

function mapTokenUsage(r: TokenUsageRow): TokenUsageDto {
  return {
    id: r.id,
    personaId: r.persona_id,
    conversationNodeId: r.conversation_node_id,
    provider: r.provider,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    estimatedUsd: r.estimated_usd,
    createdAt: r.created_at,
    roomType: r.room_type,
  }
}

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name)

  constructor(
    private readonly db: RlsDbService,
    private readonly relay: EventRelayService,
  ) {}

  // ── Conference room auto-create ─────────────────────────────────────────

  /**
   * Ensure a 'conference' room exists for the project.
   * Called by ProjectsService after project creation.
   * Uses ON CONFLICT DO NOTHING so it is safe to call multiple times.
   */
  async ensureConferenceRoom(projectId: string, userId: string): Promise<RoomDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      // Upsert the conference room (partial unique index: rooms_conference_unique)
      const rows = await tx<RoomRow[]>`
        INSERT INTO rooms (project_id, type, name, created_by)
        VALUES (${projectId}, 'conference', 'Conference', ${userId})
        ON CONFLICT ON CONSTRAINT rooms_conference_unique DO NOTHING
        RETURNING id, project_id, type, name, seed_prompt, created_by, archived_at, is_confidential, created_at, updated_at
      `
      if (rows[0]) return mapRoom(rows[0])

      // Row already existed — fetch it
      const existing = await tx<RoomRow[]>`
        SELECT id, project_id, type, name, seed_prompt, created_by, archived_at, is_confidential, created_at, updated_at
        FROM rooms
        WHERE project_id = ${projectId} AND type = 'conference'
        LIMIT 1
      `
      if (!existing[0]) throw new Error('conference room not found after upsert')
      return mapRoom(existing[0])
    })
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async create(userId: string, projectId: string, input: CreateRoomInput): Promise<RoomDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const seedPrompt = input.seedPrompt ?? null
      const rows = await tx<RoomRow[]>`
        INSERT INTO rooms (project_id, type, name, created_by, seed_prompt)
        VALUES (${projectId}, ${input.type}, ${input.name}, ${userId}, ${seedPrompt})
        RETURNING id, project_id, type, name, seed_prompt, created_by, archived_at, is_confidential, created_at, updated_at
      `
      if (!rows[0]) throw new Error('room insert returned no row')
      this.logger.log({
        event: 'room.created',
        actorId: userId,
        targetId: rows[0].id,
        action: 'create',
      })
      return mapRoom(rows[0])
    })
  }

  async list(userId: string, projectId: string, type?: string): Promise<RoomDto[]> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const rows = type
        ? await tx<RoomRow[]>`
            SELECT id, project_id, type, name, seed_prompt, created_by, archived_at, is_confidential, created_at, updated_at
            FROM rooms
            WHERE project_id = ${projectId} AND type = ${type}
            ORDER BY created_at ASC
          `
        : await tx<RoomRow[]>`
            SELECT id, project_id, type, name, seed_prompt, created_by, archived_at, is_confidential, created_at, updated_at
            FROM rooms
            WHERE project_id = ${projectId}
            ORDER BY created_at ASC
          `
      return rows.map(mapRoom)
    })
  }

  async getById(userId: string, projectId: string, roomId: string): Promise<RoomDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const rows = await tx<RoomRow[]>`
        SELECT id, project_id, type, name, seed_prompt, created_by, archived_at, is_confidential, created_at, updated_at
        FROM rooms
        WHERE id = ${roomId} AND project_id = ${projectId}
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      return mapRoom(rows[0])
    })
  }

  async update(
    userId: string,
    projectId: string,
    roomId: string,
    input: UpdateRoomInput,
  ): Promise<RoomDto> {
    // Run the transaction, capturing whether a kick is needed.
    // kickRoom must fire AFTER the tx commits — calling it inside db.run()
    // would revoke WS sessions before the archive is visible to readers.
    const { room, didArchive } = await this.db.run({ userId, projectId }, async (tx) => {
      const current = await tx<RoomRow[]>`
        SELECT id, project_id, type, name, seed_prompt, created_by, archived_at, is_confidential, created_at, updated_at
        FROM rooms
        WHERE id = ${roomId} AND project_id = ${projectId}
      `
      if (!current[0]) throw new NotFoundException({ code: 'not_found' })

      const newName = input.name ?? current[0].name
      const newArchivedAt =
        input.archived === true
          ? new Date().toISOString()
          : input.archived === false
            ? null
            : current[0].archived_at
      const newIsConfidential =
        input.isConfidential !== undefined ? input.isConfidential : current[0].is_confidential

      const rows = await tx<RoomRow[]>`
        UPDATE rooms
        SET    name           = ${newName},
               archived_at    = ${newArchivedAt},
               is_confidential = ${newIsConfidential},
               updated_at     = now()
        WHERE  id = ${roomId} AND project_id = ${projectId}
        RETURNING id, project_id, type, name, seed_prompt, created_by, archived_at, is_confidential, created_at, updated_at
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })

      this.logger.log({
        event: 'room.updated',
        actorId: userId,
        targetId: roomId,
        action: 'update',
      })
      return { room: mapRoom(rows[0]), didArchive: input.archived === true && !!rows[0].archived_at }
    })

    // Kick WS clients AFTER tx commits so the archived state is fully visible
    if (didArchive) {
      this.relay.kickRoom(roomId)
    }

    return room
  }

  // ── Participants ───────────────────────────────────────────────────────────

  async listParticipants(
    userId: string,
    projectId: string,
    roomId: string,
  ): Promise<ParticipantDto[]> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const room = await tx<{ id: string }[]>`
        SELECT id FROM rooms WHERE id = ${roomId} AND project_id = ${projectId}
      `
      if (!room[0]) throw new NotFoundException({ code: 'not_found' })

      const rows = await tx<ParticipantRow[]>`
        SELECT id, room_id, participant_kind, user_id, persona_id, created_at
        FROM room_participants
        WHERE room_id = ${roomId}
        ORDER BY created_at ASC
      `
      return rows.map(mapParticipant)
    })
  }

  async addParticipant(
    userId: string,
    projectId: string,
    roomId: string,
    input: AddParticipantInput,
  ): Promise<ParticipantDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      // Verify room belongs to project
      const room = await tx<{ id: string }[]>`
        SELECT id FROM rooms WHERE id = ${roomId} AND project_id = ${projectId}
      `
      if (!room[0]) throw new NotFoundException({ code: 'not_found' })

      if (input.participantKind === 'user' && !input.userId) {
        throw new BadRequestException({ code: 'user_id_required' })
      }
      if (input.participantKind === 'agent' && !input.personaId) {
        throw new BadRequestException({ code: 'persona_id_required' })
      }

      // Server-side roster validation: persona must be hired into the project
      if (input.participantKind === 'agent' && input.personaId) {
        const hired = await tx<{ result: number }[]>`
          SELECT 1 AS result FROM project_agents
          WHERE project_id = ${projectId} AND persona_id = ${input.personaId}
          LIMIT 1
        `
        if (!hired[0]) {
          throw new ForbiddenException({ code: 'persona_not_hired' })
        }
      }

      try {
        const rows = await tx<ParticipantRow[]>`
          INSERT INTO room_participants (room_id, participant_kind, user_id, persona_id)
          VALUES (
            ${roomId},
            ${input.participantKind},
            ${input.userId ?? null},
            ${input.personaId ?? null}
          )
          RETURNING id, room_id, participant_kind, user_id, persona_id, created_at
        `
        if (!rows[0]) throw new Error('participant insert returned no row')
        this.logger.log({
          event: 'room.participant_added',
          actorId: userId,
          targetId: roomId,
          action: 'add_participant',
        })
        return mapParticipant(rows[0])
      } catch (err: unknown) {
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === '23505'
        ) {
          throw new ConflictException({ code: 'already_participant' })
        }
        throw err
      }
    })
  }

  async removeParticipant(
    userId: string,
    projectId: string,
    roomId: string,
    participantId: string,
  ): Promise<void> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const result = await tx<{ id: string }[]>`
        DELETE FROM room_participants
        WHERE id = ${participantId}
          AND room_id = ${roomId}
          AND room_id IN (SELECT id FROM rooms WHERE project_id = ${projectId})
        RETURNING id
      `
      if (!result[0]) throw new NotFoundException({ code: 'not_found' })
      this.logger.log({
        event: 'room.participant_removed',
        actorId: userId,
        targetId: participantId,
        action: 'remove_participant',
      })
    })
  }

  // ── Token usage ───────────────────────────────────────────────────────────────

  async listTokenUsage(userId: string, projectId: string): Promise<TokenUsageDto[]> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const rows = await tx<TokenUsageRow[]>`
        SELECT
          tu.id,
          tu.persona_id,
          tu.conversation_node_id,
          tu.provider,
          tu.model,
          tu.input_tokens,
          tu.output_tokens,
          tu.estimated_usd,
          tu.created_at,
          r.type AS room_type
        FROM token_usage tu
        LEFT JOIN conversation_nodes cn ON cn.id = tu.conversation_node_id
        LEFT JOIN conversations c ON c.id = cn.conversation_id
        LEFT JOIN rooms r ON r.id = c.room_id
        WHERE tu.project_id = ${projectId}
        ORDER BY tu.created_at DESC
        LIMIT 100
      `
      return rows.map(mapTokenUsage)
    })
  }

  // ── Project agents (roster) ────────────────────────────────────────────────

  async listHiredPersonas(userId: string, projectId: string): Promise<HiredPersonaDto[]> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const rows = await tx<HiredPersonaRow[]>`
        SELECT pa.persona_id, ap.name, ap.slug, ap.title, ap.color, ap.avatar_key, pa.hired_at
        FROM project_agents pa
        JOIN agent_personas ap ON ap.id = pa.persona_id
        WHERE pa.project_id = ${projectId}
        ORDER BY pa.hired_at ASC
      `
      return rows.map(mapHiredPersona)
    })
  }

  async hirePersona(
    userId: string,
    projectId: string,
    personaId: string,
  ): Promise<HiredPersonaDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      // Verify persona exists
      const persona = await tx<HiredPersonaRow[]>`
        SELECT id AS persona_id, name, slug, title, color, avatar_key
        FROM agent_personas
        WHERE id = ${personaId}
        LIMIT 1
      `
      if (!persona[0]) throw new NotFoundException({ code: 'persona_not_found' })

      // Insert into project_agents (ignore if already hired)
      await tx`
        INSERT INTO project_agents (project_id, persona_id)
        VALUES (${projectId}, ${personaId})
        ON CONFLICT DO NOTHING
      `

      // Fetch the final row (hired_at)
      const hired = await tx<HiredPersonaRow[]>`
        SELECT pa.persona_id, ap.name, ap.slug, ap.title, ap.color, ap.avatar_key, pa.hired_at
        FROM project_agents pa
        JOIN agent_personas ap ON ap.id = pa.persona_id
        WHERE pa.project_id = ${projectId} AND pa.persona_id = ${personaId}
        LIMIT 1
      `
      if (!hired[0]) throw new Error('project_agents row not found after insert')

      // Auto-create 1:1 call room if not already present.
      // skipHiredCheck=true: we just inserted the row; personaName from above fetch.
      await this.getOrCreateCallRoom(userId, projectId, personaId, tx, {
        skipHiredCheck: true,
        personaName: persona[0].name,
      })

      this.logger.log({ event: 'persona.hired', actorId: userId, personaId, projectId })
      return mapHiredPersona(hired[0])
    })
  }

  async firePersona(userId: string, projectId: string, personaId: string): Promise<void> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const result = await tx<{ persona_id: string }[]>`
        DELETE FROM project_agents
        WHERE project_id = ${projectId} AND persona_id = ${personaId}
        RETURNING persona_id
      `
      if (!result[0]) throw new NotFoundException({ code: 'persona_not_hired' })
      this.logger.log({ event: 'persona.fired', actorId: userId, personaId, projectId })
    })
  }

  /**
   * Find or create the 1:1 call room for (userId, projectId, personaId).
   *
   * @param externalTx  Optional transaction for use inside hirePersona (same tx).
   * @param options.skipHiredCheck  When true (called from hirePersona which just
   *   inserted the row), skips the project_agents membership guard.
   *   Defaults to false — external callers (controller) must be hired.
   * @param options.personaName  Pre-fetched persona name; avoids an extra query when
   *   called from hirePersona. If omitted, fetched from agent_personas.
   */
  async getOrCreateCallRoom(
    userId: string,
    projectId: string,
    personaId: string,
    externalTx?: import('postgres').TransactionSql,
    options: { skipHiredCheck?: boolean; personaName?: string } = {},
  ): Promise<RoomDto> {
    const { skipHiredCheck = false, personaName: nameHint } = options

    const run = externalTx
      ? (fn: (tx: import('postgres').TransactionSql) => Promise<RoomDto>) => fn(externalTx)
      : (fn: (tx: import('postgres').TransactionSql) => Promise<RoomDto>) =>
          this.db.run({ userId, projectId }, fn)

    return run(async (tx) => {
      // ── Hired-persona guard (external calls only) ─────────────────────────
      let personaName: string
      if (!skipHiredCheck) {
        // Verify persona is hired AND retrieve name in one query
        const hired = await tx<{ name: string }[]>`
          SELECT ap.name
          FROM project_agents pa
          JOIN agent_personas ap ON ap.id = pa.persona_id
          WHERE pa.project_id = ${projectId} AND pa.persona_id = ${personaId}
          LIMIT 1
        `
        if (!hired[0]) throw new ForbiddenException({ code: 'persona_not_hired' })
        personaName = hired[0].name
      } else if (nameHint) {
        personaName = nameHint
      } else {
        // Fallback: fetch name directly from agent_personas
        const ap = await tx<{ name: string }[]>`
          SELECT name FROM agent_personas WHERE id = ${personaId} LIMIT 1
        `
        personaName = ap[0]?.name ?? personaId
      }

      // ── Advisory lock: serialise concurrent call-room creation ───────────
      // pg_advisory_xact_lock is released automatically when the tx commits
      // or rolls back, preventing duplicate rooms under concurrent requests.
      await tx`
        SELECT pg_advisory_xact_lock(
          hashtext(${projectId} || ':' || ${userId} || ':' || ${personaId})::bigint
        )
      `

      // ── Find existing call room ───────────────────────────────────────────
      const existing = await tx<RoomRow[]>`
        SELECT r.id, r.project_id, r.type, r.name, r.seed_prompt, r.created_by,
               r.archived_at, r.created_at, r.updated_at
        FROM rooms r
        WHERE r.project_id = ${projectId}
          AND r.type = 'call'
          AND r.created_by = ${userId}
          AND EXISTS (
            SELECT 1 FROM room_participants rp
            WHERE rp.room_id = r.id
              AND rp.participant_kind = 'agent'
              AND rp.persona_id = ${personaId}
          )
        LIMIT 1
      `
      if (existing[0]) return mapRoom(existing[0])

      // ── Create new call room ──────────────────────────────────────────────
      const name = `1:1 with ${personaName}`
      const rooms = await tx<RoomRow[]>`
        INSERT INTO rooms (project_id, type, name, created_by)
        VALUES (${projectId}, 'call', ${name}, ${userId})
        RETURNING id, project_id, type, name, seed_prompt, created_by, archived_at, is_confidential, created_at, updated_at
      `
      if (!rooms[0]) throw new Error('call room insert returned no row')

      const newRoom = rooms[0]

      // Add user participant
      await tx`
        INSERT INTO room_participants (room_id, participant_kind, user_id)
        VALUES (${newRoom.id}, 'user', ${userId})
        ON CONFLICT DO NOTHING
      `

      // Add agent participant
      await tx`
        INSERT INTO room_participants (room_id, participant_kind, persona_id)
        VALUES (${newRoom.id}, 'agent', ${personaId})
        ON CONFLICT DO NOTHING
      `

      this.logger.log({
        event: 'room.call_created',
        actorId: userId,
        roomId: newRoom.id,
        personaId,
      })
      return mapRoom(newRoom)
    })
  }
}
