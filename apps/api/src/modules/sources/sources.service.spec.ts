/**
 * SourcesService unit tests.
 *
 * Verifies:
 * 1. createSource stores encrypted credential_ref, never raw credential in config
 * 2. listSources response has no credential_ref key in any item
 * 3. getSource response has no credential_ref key
 * 4. Contract: response JSON never contains the raw credential value
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConfigService } from '@nestjs/config'
import { SourcesService, encryptCredential, decryptCredential } from './sources.service.js'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const ENCRYPTION_KEY = 'test-enc-key-32-chars-padded---1'
const RAW_CREDENTIAL = 'ghp_super_secret_token_12345'
const PROJECT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '00000000-0000-0000-0000-000000000002'
const SOURCE_ID = '00000000-0000-0000-0000-000000000003'

// Build a fake DB row that would come from postgres
function fakeSourceRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SOURCE_ID,
    project_id: PROJECT_ID,
    type: 'github_repo',
    config: { repoUrl: 'https://github.com/org/repo', branch: 'main' },
    credential_ref: encryptCredential(RAW_CREDENTIAL, ENCRYPTION_KEY),
    sync_schedule: null,
    last_sync_at: null,
    last_sync_status: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function fakeJobRow() {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    source_id: SOURCE_ID,
    status: 'done',
    stats: { chunkCount: 42 },
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

// ── Encryption round-trip ──────────────────────────────────────────────────────

describe('encryptCredential / decryptCredential', () => {
  it('round-trips correctly', () => {
    const ref = encryptCredential(RAW_CREDENTIAL, ENCRYPTION_KEY)
    expect(ref.startsWith('enc:v1:')).toBe(true)
    const decrypted = decryptCredential(ref, ENCRYPTION_KEY)
    expect(decrypted).toBe(RAW_CREDENTIAL)
  })

  it('produces different ciphertext each call (random IV)', () => {
    const ref1 = encryptCredential(RAW_CREDENTIAL, ENCRYPTION_KEY)
    const ref2 = encryptCredential(RAW_CREDENTIAL, ENCRYPTION_KEY)
    expect(ref1).not.toBe(ref2)
  })

  it('throws on tampered ciphertext', () => {
    const ref = encryptCredential(RAW_CREDENTIAL, ENCRYPTION_KEY)
    const tampered = ref.slice(0, -4) + 'XXXX'
    expect(() => decryptCredential(tampered, ENCRYPTION_KEY)).toThrow()
  })
})

// ── SourcesService ─────────────────────────────────────────────────────────────

describe('SourcesService', () => {
  let service: SourcesService
  let dbRun: ReturnType<typeof vi.fn>

  beforeEach(() => {
    dbRun = vi.fn()

    const db = { run: dbRun } as unknown as InstanceType<typeof import('../common/db/rls-db.service').RlsDbService>
    const config = {
      get: vi.fn((key: string) => {
        if (key === 'CREDENTIAL_ENCRYPTION_KEY') return ENCRYPTION_KEY
        return undefined
      }),
    } as unknown as ConfigService

    const redisStub = {
      // BullMQ Queue constructor needs a redis connection — provide minimal stub
    }

    // Manually inject because NestJS DI is not used in unit tests
    // We'll spy on sourceSyncQueue directly
    service = new SourcesService(db, config, redisStub as never)

    // Stub out the BullMQ queue that gets created in constructor
    const queueStub = {
      add: vi.fn().mockResolvedValue({ id: 'job-123' }),
      getJobs: vi.fn().mockResolvedValue([]),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(service as any).sourceSyncQueue = queueStub
  })

  // ── createSource ────────────────────────────────────────────────────────────

  it('createSource: stores encrypted credential_ref, raw credential not in config', async () => {
    let insertedValues: Record<string, unknown> = {}

    dbRun.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
        // Capture values passed to the INSERT template tag
        insertedValues = { strings: strings.join(''), values }
        return Promise.resolve([fakeSourceRow()])
      }
      return fn(tx)
    })

    const result = await service.createSource(USER_ID, PROJECT_ID, {
      type: 'github_repo',
      config: { repoUrl: 'https://github.com/org/repo', branch: 'main' },
      credential: RAW_CREDENTIAL,
    })

    // Response must NOT contain credential_ref key
    expect('credential_ref' in result).toBe(false)
    // Response must have hasCredential: true
    expect(result.hasCredential).toBe(true)

    // The values passed to the INSERT must include an encrypted ref (not raw)
    const allValues = JSON.stringify(insertedValues.values)
    expect(allValues).not.toContain(RAW_CREDENTIAL)
    // The encrypted ref must start with enc:v1:
    const credRef = (insertedValues.values as unknown[]).find(
      (v) => typeof v === 'string' && v.startsWith('enc:v1:'),
    )
    expect(credRef).toBeDefined()
  })

  it('createSource: config column never includes raw password key', async () => {
    let capturedConfig: unknown

    dbRun.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
        // Find the JSON config value (it's the 2nd positional value after projectId, type)
        capturedConfig = values.find((v) => typeof v === 'string' && v.startsWith('{'))
        return Promise.resolve([fakeSourceRow()])
      }
      return fn(tx)
    })

    await service.createSource(USER_ID, PROJECT_ID, {
      type: 'github_repo',
      config: { repoUrl: 'https://github.com/org/repo', branch: 'main' },
      credential: RAW_CREDENTIAL,
    })

    const configStr = JSON.stringify(capturedConfig)
    expect(configStr).not.toContain(RAW_CREDENTIAL)
    expect(configStr).not.toContain('password')
  })

  // ── listSources ─────────────────────────────────────────────────────────────

  it('listSources: response items have no credential_ref key', async () => {
    dbRun.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = () => Promise.resolve([fakeSourceRow(), fakeSourceRow({ type: 'url' })])
      return fn(tx)
    })

    const results = await service.listSources(USER_ID, PROJECT_ID)

    for (const item of results) {
      expect('credential_ref' in item).toBe(false)
      expect(item.hasCredential).toBe(true)
    }
    // Serialized response must not contain credential_ref
    const serialized = JSON.stringify(results)
    expect(serialized).not.toContain('credential_ref')
  })

  it('listSources: response JSON does not contain raw credential value', async () => {
    dbRun.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = () => Promise.resolve([fakeSourceRow()])
      return fn(tx)
    })

    const results = await service.listSources(USER_ID, PROJECT_ID)
    const serialized = JSON.stringify(results)
    expect(serialized).not.toContain(RAW_CREDENTIAL)
  })

  // ── getSource ───────────────────────────────────────────────────────────────

  it('getSource: response has no credential_ref key', async () => {
    dbRun.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = () => Promise.resolve([fakeSourceRow()])
      return fn(tx)
    })

    const result = await service.getSource(USER_ID, PROJECT_ID, SOURCE_ID)

    expect('credential_ref' in result).toBe(false)
    // Contract: serialized response body does not contain credential_ref key
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('credential_ref')
    expect(serialized).not.toContain(RAW_CREDENTIAL)
  })

  it('getSource: throws NotFoundException when not found', async () => {
    dbRun.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = () => Promise.resolve([])
      return fn(tx)
    })

    await expect(service.getSource(USER_ID, PROJECT_ID, SOURCE_ID)).rejects.toThrow()
  })

  // ── getHistory ───────────────────────────────────────────────────────────────

  it('getHistory: returns history entries without credential fields', async () => {
    let callCount = 0
    dbRun.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      callCount++
      if (callCount === 1) {
        // Source existence check
        const tx = () => Promise.resolve([{ id: SOURCE_ID }])
        return fn(tx)
      }
      // History fetch
      const tx = () => Promise.resolve([fakeJobRow()])
      return fn(tx)
    })

    const results = await service.getHistory(USER_ID, PROJECT_ID, SOURCE_ID)
    expect(results).toHaveLength(1)
    expect(results[0]?.sourceId).toBe(SOURCE_ID)
    expect(results[0]?.status).toBe('done')
    const serialized = JSON.stringify(results)
    expect(serialized).not.toContain('credential')
  })
})
