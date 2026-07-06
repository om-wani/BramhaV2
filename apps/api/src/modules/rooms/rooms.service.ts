import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common'
import { RlsDbService } from '../common/db/rls-db.service'
import type { CreateRoomInput, UpdateRoomInput, AddParticipantInput } from '@bramha/shared'

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface RoomDto {
  id: string
  projectId: string
  type: string
  name: string
  createdBy: string | null
  archivedAt: string | null
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

// ── Row types ─────────────────────────────────────────────────────────────────

interface RoomRow {
  id: string
  project_id: string
  type: string
  name: string
  created_by: string | null
  archived_at: string | null
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

function mapRoom(r: RoomRow): RoomDto {
  return {
    id: r.id,
    projectId: r.project_id,
    type: r.type,
    name: r.name,
    createdBy: r.created_by,
    archivedAt: r.archived_at,
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

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name)

  constructor(private readonly db: RlsDbService) {}

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
        RETURNING id, project_id, type, name, created_by, archived_at, created_at, updated_at
      `
      if (rows[0]) return mapRoom(rows[0])

      // Row already existed — fetch it
      const existing = await tx<RoomRow[]>`
        SELECT id, project_id, type, name, created_by, archived_at, created_at, updated_at
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
      const rows = await tx<RoomRow[]>`
        INSERT INTO rooms (project_id, type, name, created_by)
        VALUES (${projectId}, ${input.type}, ${input.name}, ${userId})
        RETURNING id, project_id, type, name, created_by, archived_at, created_at, updated_at
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

  async list(userId: string, projectId: string): Promise<RoomDto[]> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const rows = await tx<RoomRow[]>`
        SELECT id, project_id, type, name, created_by, archived_at, created_at, updated_at
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
        SELECT id, project_id, type, name, created_by, archived_at, created_at, updated_at
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
    return this.db.run({ userId, projectId }, async (tx) => {
      const current = await tx<RoomRow[]>`
        SELECT id, project_id, type, name, created_by, archived_at, created_at, updated_at
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

      const rows = await tx<RoomRow[]>`
        UPDATE rooms
        SET    name        = ${newName},
               archived_at = ${newArchivedAt},
               updated_at  = now()
        WHERE  id = ${roomId} AND project_id = ${projectId}
        RETURNING id, project_id, type, name, created_by, archived_at, created_at, updated_at
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      this.logger.log({
        event: 'room.updated',
        actorId: userId,
        targetId: roomId,
        action: 'update',
      })
      return mapRoom(rows[0])
    })
  }

  // ── Participants ───────────────────────────────────────────────────────────

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
}
