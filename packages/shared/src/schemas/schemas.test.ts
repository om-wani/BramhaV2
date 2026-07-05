import { describe, it, expect } from 'vitest'

import { RegisterInputSchema } from './users.js'
import { CreateOrgInputSchema } from './orgs.js'
import { CreateProjectInputSchema } from './projects.js'
import { uuidSchema, emailSchema, slugSchema } from './common.js'
import { ErrorCodes } from '../errors.js'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'
const VALID_EMAIL = 'test@example.com'
const VALID_SLUG = 'my-org'

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

describe('ErrorCodes', () => {
  it('has unique codes', () => {
    const codes = Object.values(ErrorCodes)
    const unique = new Set(codes)
    expect(unique.size).toBe(codes.length)
  })
})
