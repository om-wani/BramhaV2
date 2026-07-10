import { vi, describe, it, expect } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@bramha/db', () => ({ withTenant: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common'
import { RoomsService } from './rooms.service'
import type { RlsDbService } from '../common/db/rls-db.service'
import type { EventRelayService } from '../realtime/event-relay.service'
import type postgres from 'postgres'

// ── Constants ──────────────────────────────────────────────────────────────────

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const PROJECT_ID = 'bbbbbbbb-0000-0000-0000-000000000002'
const ROOM_ID = 'cccccccc-0000-0000-0000-000000000003'
const PERSONA_ID = 'dddddddd-0000-0000-0000-000000000004'
const PARTICIPANT_ID = 'eeeeeeee-0000-0000-0000-000000000005'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRoomRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROOM_ID,
    project_id: PROJECT_ID,
    type: 'meeting',
    name: 'Pricing War-Room',
    seed_prompt: null,
    created_by: USER_ID,
    archived_at: null,
    created_at: '2024-01-01T00:00:00+00:00',
    updated_at: '2024-01-01T00:00:00+00:00',
    ...overrides,
  }
}

function makeParticipantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PARTICIPANT_ID,
    room_id: ROOM_ID,
    participant_kind: 'agent',
    user_id: null,
    persona_id: PERSONA_ID,
    created_at: '2024-01-01T00:00:00+00:00',
    ...overrides,
  }
}

function makeHiredPersonaRow(overrides: Record<string, unknown> = {}) {
  return {
    persona_id: PERSONA_ID,
    name: 'Ledger',
    slug: 'cfo',
    title: 'Chief Financial Officer',
    color: '#8b5cf6',
    avatar_key: null,
    hired_at: '2024-01-01T00:00:00+00:00',
    ...overrides,
  }
}

/**
 * Build a mock tx that returns rows in sequence per call.
 * Each element of `results` is what one tx`...` template-literal call returns.
 */
function makeTx(results: unknown[][]): postgres.TransactionSql {
  let call = 0
  return vi.fn().mockImplementation(() => Promise.resolve(results[call++] ?? [])) as unknown as postgres.TransactionSql
}

function buildMocks(txResults: unknown[][]) {
  const tx = makeTx(txResults)
  const db: Partial<RlsDbService> = {
    run: vi.fn().mockImplementation((_ctx, fn: (tx: postgres.TransactionSql) => unknown) => fn(tx)),
  }
  const relay: Partial<EventRelayService> = {
    kickRoom: vi.fn(),
  }
  return { db, relay, tx }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RoomsService', () => {
  // ── hirePersona ─────────────────────────────────────────────────────────────

  describe('hirePersona', () => {
    it('inserts into project_agents and returns the persona DTO', async () => {
      const personaRow = { id: PERSONA_ID, name: 'Ledger', slug: 'cfo', title: 'Chief Financial Officer', color: '#8b5cf6', avatar_key: null }
      const hiredRow = makeHiredPersonaRow()
      const callRoom = makeRoomRow({ type: 'call' })

      // tx calls in order (skipHiredCheck=true + personaName hint skips name query):
      // 1. SELECT agent_personas (persona exists + name)
      // 2. INSERT INTO project_agents
      // 3. SELECT hired row
      // 4. SELECT pg_advisory_xact_lock   ← getOrCreateCallRoom serialises concurrent creates
      // 5. SELECT existing call room (none found)
      // 6. INSERT new call room
      // 7. INSERT user participant
      // 8. INSERT agent participant
      const { db, relay } = buildMocks([
        [personaRow],  // SELECT agent_personas
        [],            // INSERT project_agents ON CONFLICT DO NOTHING
        [hiredRow],    // SELECT hired row
        [],            // SELECT pg_advisory_xact_lock (advisory lock)
        [],            // SELECT existing call room (not found)
        [{ ...callRoom, type: 'call', name: '1:1 with Ledger' }], // INSERT call room
        [],            // INSERT user participant
        [],            // INSERT agent participant
      ])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)
      const result = await service.hirePersona(USER_ID, PROJECT_ID, PERSONA_ID)

      expect(result.personaId).toBe(PERSONA_ID)
      expect(result.name).toBe('Ledger')
      expect(result.role).toBe('Chief Financial Officer')
      expect(result.accentColor).toBe('#8b5cf6')
    })

    it('returns persona DTO even when already hired (ON CONFLICT DO NOTHING)', async () => {
      const personaRow = { id: PERSONA_ID, name: 'Ledger', slug: 'cfo', title: null, color: null, avatar_key: null }
      const hiredRow = makeHiredPersonaRow()
      const existingCallRoom = makeRoomRow({ type: 'call' })

      // tx calls: persona found, insert (no-op), hired row found, advisory lock, existing call room found
      const { db, relay } = buildMocks([
        [personaRow],
        [],
        [hiredRow],
        [],              // SELECT pg_advisory_xact_lock (advisory lock)
        [existingCallRoom],  // existing call room → skip creation
      ])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)
      const result = await service.hirePersona(USER_ID, PROJECT_ID, PERSONA_ID)

      expect(result.personaId).toBe(PERSONA_ID)
    })
  })

  // ── addParticipant ───────────────────────────────────────────────────────────

  describe('addParticipant', () => {
    it('adds an agent participant when persona is in project_agents', async () => {
      const participantRow = makeParticipantRow()

      // tx calls: SELECT room, SELECT project_agents (hired), INSERT participant
      const { db, relay } = buildMocks([
        [{ id: ROOM_ID }],    // room exists
        [{ result: 1 }],       // persona is hired
        [participantRow],      // INSERT participant
      ])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)
      const result = await service.addParticipant(USER_ID, PROJECT_ID, ROOM_ID, {
        participantKind: 'agent',
        personaId: PERSONA_ID,
      })

      expect(result.personaId).toBe(PERSONA_ID)
      expect(result.participantKind).toBe('agent')
    })

    it('throws ForbiddenException (persona_not_hired) when persona is not in project_agents', async () => {
      // tx calls: SELECT room (found), SELECT project_agents (NOT found)
      const { db, relay } = buildMocks([
        [{ id: ROOM_ID }],  // room exists
        [],                  // persona NOT hired
      ])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)

      await expect(
        service.addParticipant(USER_ID, PROJECT_ID, ROOM_ID, {
          participantKind: 'agent',
          personaId: PERSONA_ID,
        }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('throws NotFoundException when room does not belong to project', async () => {
      // tx calls: SELECT room (NOT found)
      const { db, relay } = buildMocks([[]])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)

      await expect(
        service.addParticipant(USER_ID, PROJECT_ID, ROOM_ID, {
          participantKind: 'agent',
          personaId: PERSONA_ID,
        }),
      ).rejects.toThrow(NotFoundException)
    })

    it('throws ConflictException when participant already exists (pg error 23505)', async () => {
      const pgDuplicate = Object.assign(new Error('unique violation'), { code: '23505' })

      const tx = vi.fn()
        .mockImplementationOnce(() => Promise.resolve([{ id: ROOM_ID }]))  // room check
        .mockImplementationOnce(() => Promise.resolve([{ result: 1 }]))    // hired check
        .mockImplementationOnce(() => Promise.reject(pgDuplicate))          // insert throws
      const db: Partial<RlsDbService> = {
        run: vi.fn().mockImplementation((_ctx, fn) => fn(tx as unknown as postgres.TransactionSql)),
      }
      const relay: Partial<EventRelayService> = { kickRoom: vi.fn() }

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)

      await expect(
        service.addParticipant(USER_ID, PROJECT_ID, ROOM_ID, {
          participantKind: 'agent',
          personaId: PERSONA_ID,
        }),
      ).rejects.toThrow(ConflictException)
    })

    it('throws BadRequestException when user participant missing userId', async () => {
      const { db, relay } = buildMocks([[{ id: ROOM_ID }]])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)

      await expect(
        service.addParticipant(USER_ID, PROJECT_ID, ROOM_ID, {
          participantKind: 'user',
          userId: undefined,
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ── update / archive + kickRoom ───────────────────────────────────────────────

  describe('update', () => {
    it('calls relay.kickRoom when archiving a room', async () => {
      const currentRow = makeRoomRow()
      const updatedRow = makeRoomRow({ archived_at: '2024-06-01T00:00:00+00:00' })

      const { db, relay } = buildMocks([
        [currentRow],   // SELECT current
        [updatedRow],   // UPDATE RETURNING
      ])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)
      await service.update(USER_ID, PROJECT_ID, ROOM_ID, { archived: true })

      expect(relay.kickRoom).toHaveBeenCalledWith(ROOM_ID)
    })

    it('does NOT call relay.kickRoom when updating name only', async () => {
      const currentRow = makeRoomRow()
      const updatedRow = makeRoomRow({ name: 'New Name' })

      const { db, relay } = buildMocks([
        [currentRow],
        [updatedRow],
      ])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)
      await service.update(USER_ID, PROJECT_ID, ROOM_ID, { name: 'New Name' })

      expect(relay.kickRoom).not.toHaveBeenCalled()
    })

    it('throws NotFoundException when room does not exist', async () => {
      const { db, relay } = buildMocks([[]])  // no current row

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)

      await expect(
        service.update(USER_ID, PROJECT_ID, ROOM_ID, { archived: true }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  // ── getOrCreateCallRoom ────────────────────────────────────────────────────────

  describe('getOrCreateCallRoom', () => {
    it('returns existing call room when persona is hired', async () => {
      const existingRoom = makeRoomRow({ type: 'call' })

      // External call (skipHiredCheck=false):
      // tx[0] = hired check + name
      // tx[1] = advisory lock
      // tx[2] = existing room query
      const { db, relay } = buildMocks([
        [{ name: 'Ledger' }],  // project_agents JOIN agent_personas (hired + name)
        [],                     // SELECT pg_advisory_xact_lock (advisory lock)
        [existingRoom],         // existing call room found
      ])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)
      const result = await service.getOrCreateCallRoom(USER_ID, PROJECT_ID, PERSONA_ID)

      expect(result.id).toBe(ROOM_ID)
      expect(result.type).toBe('call')
    })

    it('creates a new call room using persona name when none exists', async () => {
      const newRoom = makeRoomRow({ type: 'call', name: '1:1 with Ledger' })

      // External call:
      // tx[0] = hired check (found, name='Ledger')
      // tx[1] = advisory lock
      // tx[2] = existing call room (not found)
      // tx[3] = INSERT room
      // tx[4] = INSERT user participant
      // tx[5] = INSERT agent participant
      const { db, relay } = buildMocks([
        [{ name: 'Ledger' }],
        [],            // SELECT pg_advisory_xact_lock (advisory lock)
        [],            // existing call room (not found)
        [newRoom],
        [],
        [],
      ])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)
      const result = await service.getOrCreateCallRoom(USER_ID, PROJECT_ID, PERSONA_ID)

      expect(result.type).toBe('call')
      expect(result.name).toBe('1:1 with Ledger')
    })

    it('throws ForbiddenException when persona is not hired (external call)', async () => {
      // tx[0] = hired check returns empty
      const { db, relay } = buildMocks([[]])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)

      await expect(
        service.getOrCreateCallRoom(USER_ID, PROJECT_ID, PERSONA_ID),
      ).rejects.toThrow(ForbiddenException)
    })

    it('skips hired check when skipHiredCheck=true and uses provided name', async () => {
      const existingRoom = makeRoomRow({ type: 'call' })

      // With skipHiredCheck=true and personaName provided:
      // tx[0] = advisory lock (hired check skipped, name hint provided)
      // tx[1] = existing call room found
      const { db, relay } = buildMocks([
        [],            // SELECT pg_advisory_xact_lock (advisory lock)
        [existingRoom],
      ])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)
      const result = await service.getOrCreateCallRoom(
        USER_ID, PROJECT_ID, PERSONA_ID, undefined,
        { skipHiredCheck: true, personaName: 'Ledger' },
      )

      expect(result.id).toBe(ROOM_ID)
    })
  })

  // ── listHiredPersonas ─────────────────────────────────────────────────────────

  describe('listHiredPersonas', () => {
    it('returns list of hired persona DTOs', async () => {
      const row = makeHiredPersonaRow()
      const { db, relay } = buildMocks([[row]])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)
      const result = await service.listHiredPersonas(USER_ID, PROJECT_ID)

      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Ledger')
      expect(result[0]!.role).toBe('Chief Financial Officer')
    })

    it('returns empty array when no personas hired', async () => {
      const { db, relay } = buildMocks([[]])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)
      const result = await service.listHiredPersonas(USER_ID, PROJECT_ID)

      expect(result).toEqual([])
    })
  })

  // ── listTokenUsage ────────────────────────────────────────────────────────────

  describe('listTokenUsage', () => {
    it('returns token usage rows mapped with roomType', async () => {
      const row = {
        id: 'ffffffff-0000-0000-0000-000000000001',
        persona_id: PERSONA_ID,
        conversation_node_id: null,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        input_tokens: 1200,
        output_tokens: 300,
        estimated_usd: '0.012000',
        created_at: '2024-01-01T00:00:00+00:00',
        room_type: 'meeting',
      }
      const { db, relay } = buildMocks([[row]])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)
      const result = await service.listTokenUsage(USER_ID, PROJECT_ID)

      expect(result).toHaveLength(1)
      expect(result[0]!.roomType).toBe('meeting')
      expect(result[0]!.inputTokens).toBe(1200)
      expect(result[0]!.provider).toBe('anthropic')
    })

    it('returns empty array when no usage rows exist', async () => {
      const { db, relay } = buildMocks([[]])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)
      const result = await service.listTokenUsage(USER_ID, PROJECT_ID)

      expect(result).toEqual([])
    })

    it('maps null roomType when no room context on the usage row', async () => {
      const row = {
        id: 'ffffffff-0000-0000-0000-000000000002',
        persona_id: null,
        conversation_node_id: null,
        provider: 'openai',
        model: 'gpt-4o',
        input_tokens: 500,
        output_tokens: 100,
        estimated_usd: '0.003000',
        created_at: '2024-01-01T00:00:00+00:00',
        room_type: null,
      }
      const { db, relay } = buildMocks([[row]])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)
      const result = await service.listTokenUsage(USER_ID, PROJECT_ID)

      expect(result[0]!.roomType).toBeNull()
    })
  })

  // ── firePersona ───────────────────────────────────────────────────────────────

  describe('firePersona', () => {
    it('deletes from project_agents successfully', async () => {
      const { db, relay } = buildMocks([[{ persona_id: PERSONA_ID }]])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)

      await expect(service.firePersona(USER_ID, PROJECT_ID, PERSONA_ID)).resolves.toBeUndefined()
    })

    it('throws NotFoundException when persona not in project_agents', async () => {
      const { db, relay } = buildMocks([[]])

      const service = new RoomsService(db as RlsDbService, relay as EventRelayService)

      await expect(service.firePersona(USER_ID, PROJECT_ID, PERSONA_ID)).rejects.toThrow(NotFoundException)
    })
  })
})
