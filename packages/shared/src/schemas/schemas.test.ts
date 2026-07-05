import { describe, it, expect } from 'vitest'

import { RegisterInputSchema } from './users.js'
import { CreateOrgInputSchema } from './orgs.js'
import { CreateProjectInputSchema, UpdateProjectInputSchema } from './projects.js'
import {
  OrgMemberSchema,
  ProjectMemberSchema,
  InviteOrgMemberInputSchema,
} from './members.js'
import { SessionSchema } from './sessions.js'
import { uuidSchema, emailSchema, slugSchema } from './common.js'
import { ErrorCodes } from '../errors.js'
import { WsClientEventSchema, WsServerEventSchema } from '../ws-protocol.js'
import { AuditEventSchema } from '../events/index.js'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'
const VALID_UUID_2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const VALID_EMAIL = 'test@example.com'
const VALID_SLUG = 'my-org'
const VALID_ISO_DATE = '2024-01-15T10:30:00+00:00'

describe('RegisterInputSchema', () => {
  it('parses valid input', () => {
    const input = { email: VALID_EMAIL, password: 'password123', displayName: 'Test User' }
    const result = RegisterInputSchema.parse(input)
    expect(result.email).toBe(VALID_EMAIL)
  })

  it('rejects unknown keys (strict mode)', () => {
    expect(() =>
      RegisterInputSchema.parse({
        email: VALID_EMAIL,
        password: 'password123',
        displayName: 'Test',
        extra: 'x',
      }),
    ).toThrow()
  })

  it('rejects weak password (< 8 chars)', () => {
    expect(() =>
      RegisterInputSchema.parse({ email: VALID_EMAIL, password: 'short', displayName: 'Test' }),
    ).toThrow()
  })

  it('round-trips: parse → JSON → re-parse', () => {
    const input = { email: VALID_EMAIL, password: 'password123', displayName: 'Test' }
    const parsed = RegisterInputSchema.parse(input)
    const reparsed = RegisterInputSchema.parse(JSON.parse(JSON.stringify(parsed)))
    expect(reparsed.email).toBe(parsed.email)
  })
})

describe('emailSchema', () => {
  it('normalizes email to lowercase', () => {
    expect(emailSchema.parse('Test@Example.COM')).toBe('test@example.com')
  })

  it('rejects invalid email', () => {
    expect(() => emailSchema.parse('not-an-email')).toThrow()
  })
})

describe('slugSchema', () => {
  it('accepts valid slug', () => {
    expect(slugSchema.parse(VALID_SLUG)).toBe(VALID_SLUG)
  })

  it('rejects slug with spaces', () => {
    expect(() => slugSchema.parse('my org')).toThrow()
  })

  it('rejects uppercase', () => {
    expect(() => slugSchema.parse('MyOrg')).toThrow()
  })
})

describe('uuidSchema', () => {
  it('accepts valid UUID', () => {
    expect(uuidSchema.parse(VALID_UUID)).toBe(VALID_UUID)
  })

  it('rejects non-UUID string', () => {
    expect(() => uuidSchema.parse('not-a-uuid')).toThrow()
  })
})

describe('CreateOrgInputSchema', () => {
  it('rejects unknown keys', () => {
    expect(() =>
      CreateOrgInputSchema.parse({ name: 'My Org', slug: VALID_SLUG, extra: 'x' }),
    ).toThrow()
  })

  it('round-trips', () => {
    const input = { name: 'My Org', slug: VALID_SLUG }
    const parsed = CreateOrgInputSchema.parse(input)
    expect(CreateOrgInputSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })
})

describe('CreateProjectInputSchema', () => {
  it('rejects unknown keys', () => {
    expect(() =>
      CreateProjectInputSchema.parse({ orgId: VALID_UUID, name: 'Proj', extra: 'x' }),
    ).toThrow()
  })

  it('round-trips', () => {
    const input = { orgId: VALID_UUID, name: 'My Project' }
    const parsed = CreateProjectInputSchema.parse(input)
    expect(CreateProjectInputSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })
})

describe('UpdateProjectInputSchema', () => {
  it('accepts partial settings patch (only agentsPaused provided)', () => {
    // .partial() makes each field optional; .default() still fills in omitted fields
    const input = { settings: { agentsPaused: true } }
    const parsed = UpdateProjectInputSchema.parse(input)
    expect(parsed.settings?.agentsPaused).toBe(true)
    // tokenBudgetPerDayUsd default (10) is applied by Zod for omitted fields
    expect(parsed.settings?.tokenBudgetPerDayUsd).toBe(10)
  })

  it('accepts fully empty patch', () => {
    expect(() => UpdateProjectInputSchema.parse({})).not.toThrow()
  })

  it('rejects unknown keys', () => {
    expect(() => UpdateProjectInputSchema.parse({ extra: 'x' })).toThrow()
  })
})

describe('SessionSchema', () => {
  const validSession = {
    id: VALID_UUID,
    userId: VALID_UUID_2,
    userAgent: 'Mozilla/5.0',
    ip: '127.0.0.1',
    expiresAt: VALID_ISO_DATE,
    revokedAt: null,
    createdAt: VALID_ISO_DATE,
  }

  it('parses valid session', () => {
    const result = SessionSchema.parse(validSession)
    expect(result.id).toBe(VALID_UUID)
  })

  it('round-trips', () => {
    const parsed = SessionSchema.parse(validSession)
    expect(SessionSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })

  it('rejects unknown keys', () => {
    expect(() => SessionSchema.parse({ ...validSession, extra: 'x' })).toThrow()
  })
})

describe('OrgMemberSchema', () => {
  const validMember = {
    orgId: VALID_UUID,
    userId: VALID_UUID_2,
    role: 'member' as const,
    createdAt: VALID_ISO_DATE,
  }

  it('parses valid member', () => {
    const result = OrgMemberSchema.parse(validMember)
    expect(result.role).toBe('member')
  })

  it('round-trips', () => {
    const parsed = OrgMemberSchema.parse(validMember)
    expect(OrgMemberSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })
})

describe('ProjectMemberSchema', () => {
  const validMember = {
    projectId: VALID_UUID,
    userId: VALID_UUID_2,
    role: 'editor' as const,
    createdAt: VALID_ISO_DATE,
  }

  it('parses valid member', () => {
    const result = ProjectMemberSchema.parse(validMember)
    expect(result.role).toBe('editor')
  })

  it('round-trips', () => {
    const parsed = ProjectMemberSchema.parse(validMember)
    expect(ProjectMemberSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })
})

describe('InviteOrgMemberInputSchema', () => {
  it('normalizes invite email to lowercase', () => {
    const result = InviteOrgMemberInputSchema.parse({
      email: 'ADMIN@Example.COM',
      role: 'admin',
    })
    expect(result.email).toBe('admin@example.com')
  })

  it('rejects invalid email', () => {
    expect(() =>
      InviteOrgMemberInputSchema.parse({ email: 'not-an-email', role: 'member' }),
    ).toThrow()
  })
})

describe('WsClientEventSchema', () => {
  it('parses valid room.join event', () => {
    const event = { type: 'room.join', roomId: VALID_UUID }
    const result = WsClientEventSchema.parse(event)
    expect(result.type).toBe('room.join')
  })

  it('round-trips room.join event', () => {
    const event = { type: 'room.join', roomId: VALID_UUID }
    const parsed = WsClientEventSchema.parse(event)
    expect(WsClientEventSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })

  it('rejects unknown event type', () => {
    expect(() => WsClientEventSchema.parse({ type: 'unknown', roomId: VALID_UUID })).toThrow()
  })
})

describe('WsServerEventSchema', () => {
  const validConvEvent = {
    type: 'conv.node.created',
    roomId: VALID_UUID,
    nodeId: VALID_UUID_2,
    branchId: VALID_UUID,
    actorId: VALID_UUID_2,
    actorType: 'user',
    createdAt: VALID_ISO_DATE,
  }

  it('parses valid conv.node.created event', () => {
    const result = WsServerEventSchema.parse(validConvEvent)
    expect(result.type).toBe('conv.node.created')
  })

  it('round-trips conv.node.created event', () => {
    const parsed = WsServerEventSchema.parse(validConvEvent)
    expect(WsServerEventSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })

  it('parses valid system.error event', () => {
    const event = { type: 'system.error', code: 'internal_error', message: 'Oops' }
    const result = WsServerEventSchema.parse(event)
    expect(result.type).toBe('system.error')
  })
})

describe('AuditEventSchema', () => {
  const validAudit = {
    eventType: 'user.login',
    actorId: VALID_UUID,
    targetId: null,
    targetType: null,
    projectId: null,
    ip: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    metadata: { success: true },
    occurredAt: VALID_ISO_DATE,
  }

  it('parses valid audit event', () => {
    const result = AuditEventSchema.parse(validAudit)
    expect(result.eventType).toBe('user.login')
  })

  it('round-trips', () => {
    const parsed = AuditEventSchema.parse(validAudit)
    expect(AuditEventSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })

  it('rejects unknown keys', () => {
    expect(() => AuditEventSchema.parse({ ...validAudit, extra: 'x' })).toThrow()
  })
})

describe('ErrorCodes', () => {
  it('has unique codes', () => {
    const codes = Object.values(ErrorCodes)
    const unique = new Set(codes)
    expect(unique.size).toBe(codes.length)
  })
})
