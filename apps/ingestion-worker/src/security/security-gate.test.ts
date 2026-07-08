/**
 * SecurityGateProcessor — unit tests.
 *
 * All external I/O (S3, ClamAV, DB, Redis) is injected as mocks.
 * file-type is mocked at the module level so magic-check.ts never touches
 * the real package.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SecurityGateProcessor } from './security-gate.processor.js'
import { ClamAvDownError, ZipBombError } from './errors.js'
import type { ClamAvResult } from './steps/clamav-scan.js'
import type { Disarmer, SecurityGateDeps } from './security-gate.processor.js'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn(),
}))

// ── Import mocked module ──────────────────────────────────────────────────────

import { fileTypeFromBuffer } from 'file-type'

const mockFileType = vi.mocked(fileTypeFromBuffer)

// ── Test constants ────────────────────────────────────────────────────────────

// Valid RFC 4122 v4 UUIDs (version digit = 4, variant = 8)
const BASE_FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BASE_PROJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const BASE_STORAGE_KEY = 'uploads/test-file'

function makeJobData(overrides: {
  fileId?: string
  projectId?: string
  userId?: string
  storageKey?: string
  declaredMime?: string
  fileName?: string
  sizeBytes?: number
} = {}) {
  return {
    fileId: BASE_FILE_ID,
    projectId: BASE_PROJECT_ID,
    userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    storageKey: BASE_STORAGE_KEY,
    declaredMime: 'application/pdf',
    fileName: 'test.pdf',
    sizeBytes: 1024,
    ...overrides,
  }
}

function makeJob(data: ReturnType<typeof makeJobData>) {
  return { data } as import('bullmq').Job<typeof data>
}

/**
 * Factory for a processor instance with all mocks pre-wired.
 * The caller can override scanResult, downloadBuffer, disarmers, maxFileBytes.
 */
function makeProcessor(opts: {
  scanResult?: ClamAvResult | 'down'
  downloadBuffer?: Buffer
  downloadError?: Error
  disarmers?: Map<string, Disarmer>
  maxFileBytes?: number
}) {
  const {
    scanResult = { verdict: 'clean' as const },
    downloadBuffer = Buffer.from('fake-file-bytes'),
    downloadError,
    disarmers,
    maxFileBytes,
  } = opts

  // Simple vi.fn() mocks — cast to the expected dep function types
  const mockDownloadFile = vi.fn().mockImplementation(() => {
    if (downloadError) return Promise.reject(downloadError)
    return Promise.resolve(downloadBuffer)
  }) as SecurityGateDeps['downloadFile']

  const mockQuarantineFile = vi
    .fn()
    .mockResolvedValue(undefined) as SecurityGateDeps['quarantineFile']

  const mockPromoteFile = vi
    .fn()
    .mockResolvedValue(undefined) as SecurityGateDeps['promoteFile']

  const mockPublish = vi.fn().mockResolvedValue(undefined) as (
    channel: string,
    payload: unknown,
  ) => Promise<void>

  const mockUpdateFileStatus = vi
    .fn()
    .mockResolvedValue(undefined) as SecurityGateDeps['updateFileStatus']

  const mockScanWithClamAv = vi.fn().mockImplementation(() => {
    if (scanResult === 'down') {
      return Promise.reject(new ClamAvDownError(new Error('Connection refused')))
    }
    return Promise.resolve(scanResult)
  }) as SecurityGateDeps['scanWithClamAv']

  const processor = new SecurityGateProcessor({
    downloadFile: mockDownloadFile,
    quarantineFile: mockQuarantineFile,
    promoteFile: mockPromoteFile,
    publisher: { publish: mockPublish },
    updateFileStatus: mockUpdateFileStatus,
    scanWithClamAv: mockScanWithClamAv,
    disarmers,
    maxFileBytes,
  })

  return {
    processor,
    mocks: {
      mockDownloadFile,
      mockQuarantineFile,
      mockPromoteFile,
      mockPublish,
      mockUpdateFileStatus,
      mockScanWithClamAv,
    },
  }
}

// ── Scenario tests ────────────────────────────────────────────────────────────

describe('SecurityGateProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── 1. EICAR ──────────────────────────────────────────────────────────────
  it('1. EICAR — virus found → quarantined', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFileType.mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' } as any)

    const { processor, mocks } = makeProcessor({
      scanResult: { verdict: 'virus', threatName: 'EICAR-Test-Signature' },
    })

    await processor.process(makeJob(makeJobData({ declaredMime: 'application/pdf' })))

    expect(mocks.mockQuarantineFile).toHaveBeenCalledOnce()
    expect(mocks.mockQuarantineFile).toHaveBeenCalledWith(BASE_STORAGE_KEY, BASE_PROJECT_ID, BASE_FILE_ID)

    expect(mocks.mockUpdateFileStatus).toHaveBeenCalledWith(
      BASE_FILE_ID, 'quarantined',
      expect.objectContaining({ reason: 'virus_found', threatName: 'EICAR-Test-Signature' }),
    )
    expect(mocks.mockPublish).toHaveBeenCalledWith(
      `ingest.file.quarantined:${BASE_PROJECT_ID}`,
      expect.objectContaining({ reason: 'virus_found', threatName: 'EICAR-Test-Signature' }),
    )
    expect(mocks.mockPromoteFile).not.toHaveBeenCalled()
    expect(mocks.mockUpdateFileStatus).not.toHaveBeenCalledWith(expect.anything(), 'clean', expect.anything())
  })

  // ── 2. PDF with JS ────────────────────────────────────────────────────────
  it('2. PDF with JS — disarmed, promoted clean, disarmed=true', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFileType.mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' } as any)

    const pdfBuffer = Buffer.from('%PDF-1.4 fake')
    const disarmedPdfBuffer = Buffer.from('%PDF-1.4 cleaned')
    const mockPdfDisarmer = vi
      .fn<(b: Buffer, m: string) => Promise<Buffer>>()
      .mockResolvedValue(disarmedPdfBuffer)

    const { processor, mocks } = makeProcessor({
      downloadBuffer: pdfBuffer,
      disarmers: new Map<string, Disarmer>([['application/pdf', mockPdfDisarmer]]),
    })

    await processor.process(makeJob(makeJobData({ declaredMime: 'application/pdf', fileName: 'doc.pdf' })))

    expect(mockPdfDisarmer).toHaveBeenCalledWith(pdfBuffer, 'application/pdf')
    expect(mocks.mockPromoteFile).toHaveBeenCalledWith(
      `${BASE_PROJECT_ID}/${BASE_FILE_ID}/doc.pdf`,
      disarmedPdfBuffer,
      BASE_STORAGE_KEY,
      'application/pdf',
    )
    expect(mocks.mockUpdateFileStatus).toHaveBeenCalledWith(
      BASE_FILE_ID, 'clean',
      expect.objectContaining({ verdict: 'clean', disarmed: true }),
    )
    expect(mocks.mockPublish).toHaveBeenCalledWith(
      `ingest.file.clean:${BASE_PROJECT_ID}`,
      expect.objectContaining({ scanReport: { verdict: 'clean', disarmed: true } }),
    )
    expect(mocks.mockQuarantineFile).not.toHaveBeenCalled()
  })

  // ── 3. GIF renamed PDF ────────────────────────────────────────────────────
  it('3. GIF renamed PDF — mime_mismatch → quarantined', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFileType.mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' } as any)

    const { processor, mocks } = makeProcessor({})

    await processor.process(makeJob(makeJobData({ declaredMime: 'image/gif', fileName: 'trick.gif' })))

    expect(mocks.mockQuarantineFile).toHaveBeenCalledOnce()
    expect(mocks.mockUpdateFileStatus).toHaveBeenCalledWith(
      BASE_FILE_ID, 'quarantined',
      expect.objectContaining({ reason: 'mime_mismatch' }),
    )
    expect(mocks.mockPublish).toHaveBeenCalledWith(
      `ingest.file.quarantined:${BASE_PROJECT_ID}`,
      expect.objectContaining({ reason: 'mime_mismatch' }),
    )
    expect(mocks.mockScanWithClamAv).not.toHaveBeenCalled()
    expect(mocks.mockPromoteFile).not.toHaveBeenCalled()
  })

  // ── 4. Zip bomb ───────────────────────────────────────────────────────────
  it('4. Zip bomb — disarmer throws ZipBombError → quarantined', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFileType.mockResolvedValue({ mime: 'application/zip', ext: 'zip' } as any)

    const mockZipDisarmer = vi
      .fn<(b: Buffer, m: string) => Promise<Buffer>>()
      .mockRejectedValue(new ZipBombError('Compression ratio 200× exceeds 100×'))

    const { processor, mocks } = makeProcessor({
      disarmers: new Map<string, Disarmer>([['application/zip', mockZipDisarmer]]),
    })

    await processor.process(makeJob(makeJobData({ declaredMime: 'application/zip', fileName: 'bomb.zip' })))

    expect(mockZipDisarmer).toHaveBeenCalledOnce()
    expect(mocks.mockQuarantineFile).toHaveBeenCalledOnce()
    expect(mocks.mockUpdateFileStatus).toHaveBeenCalledWith(
      BASE_FILE_ID, 'quarantined',
      expect.objectContaining({ reason: 'disarm_failed' }),
    )
    expect(mocks.mockPublish).toHaveBeenCalledWith(
      `ingest.file.quarantined:${BASE_PROJECT_ID}`,
      expect.objectContaining({ reason: 'disarm_failed' }),
    )
    expect(mocks.mockPromoteFile).not.toHaveBeenCalled()
  })

  // ── 5. SVG with onload ────────────────────────────────────────────────────
  it('5. SVG with onload — sanitized, promoted clean, disarmed=true', async () => {
    // SVG has no magic bytes
    mockFileType.mockResolvedValue(undefined)

    const svgInput = Buffer.from('<svg onload="alert(1)"><text>Hello</text></svg>')
    const svgSanitized = Buffer.from('<svg><text>Hello</text></svg>')
    const mockSvgDisarmer = vi
      .fn<(b: Buffer, m: string) => Promise<Buffer>>()
      .mockResolvedValue(svgSanitized)

    const { processor, mocks } = makeProcessor({
      downloadBuffer: svgInput,
      disarmers: new Map<string, Disarmer>([['image/svg+xml', mockSvgDisarmer]]),
    })

    await processor.process(makeJob(makeJobData({ declaredMime: 'image/svg+xml', fileName: 'icon.svg' })))

    expect(mockSvgDisarmer).toHaveBeenCalledWith(svgInput, 'image/svg+xml')
    expect(mocks.mockPromoteFile).toHaveBeenCalledWith(
      `${BASE_PROJECT_ID}/${BASE_FILE_ID}/icon.svg`,
      svgSanitized,
      BASE_STORAGE_KEY,
      'image/svg+xml',
    )
    expect(mocks.mockUpdateFileStatus).toHaveBeenCalledWith(
      BASE_FILE_ID, 'clean',
      expect.objectContaining({ disarmed: true }),
    )
    expect(mocks.mockPublish).toHaveBeenCalledWith(
      `ingest.file.clean:${BASE_PROJECT_ID}`,
      expect.objectContaining({ scanReport: { verdict: 'clean', disarmed: true } }),
    )
    expect(mocks.mockQuarantineFile).not.toHaveBeenCalled()
  })

  // ── 6. Polyglot JPEG/HTML — magic passes, image disarmer re-encodes → clean ─
  it('6. Polyglot JPEG/HTML — magic passes, sharp re-encodes, strips HTML → clean', async () => {
    // True polyglot: valid JPEG magic bytes prefix + embedded HTML payload.
    // Magic check detects image/jpeg (matches declared) → passes.
    // ClamAV clears it. Image disarmer re-encodes through sharp, stripping HTML.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFileType.mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' } as any)

    const polyglotBuffer = Buffer.from('\xFF\xD8\xFF<html>evil</html>')
    const disarmedBuffer = Buffer.from('\xFF\xD8\xFF\xE0clean-jpeg-bytes')

    const mockImageDisarmer = vi
      .fn<(b: Buffer, m: string) => Promise<Buffer>>()
      .mockResolvedValue(disarmedBuffer)

    const { processor, mocks } = makeProcessor({
      downloadBuffer: polyglotBuffer,
      disarmers: new Map<string, Disarmer>([['image/jpeg', mockImageDisarmer]]),
    })

    await processor.process(makeJob(makeJobData({ declaredMime: 'image/jpeg', fileName: 'photo.jpg' })))

    expect(mockImageDisarmer).toHaveBeenCalledWith(polyglotBuffer, 'image/jpeg')
    expect(mocks.mockUpdateFileStatus).toHaveBeenCalledWith(
      BASE_FILE_ID, 'clean',
      expect.objectContaining({ verdict: 'clean', disarmed: true }),
    )
    expect(mocks.mockPublish).toHaveBeenCalledWith(
      `ingest.file.clean:${BASE_PROJECT_ID}`,
      expect.objectContaining({ scanReport: { verdict: 'clean', disarmed: true } }),
    )
    expect(mocks.mockQuarantineFile).not.toHaveBeenCalled()
  })

  // ── 6b. HTML declared as JPEG — mime_mismatch → quarantined ──────────────
  it('6b. HTML declared as JPEG — magic detects text/html → mime_mismatch → quarantined', async () => {
    // Attacker renames an HTML file as photo.jpg. Magic check detects text/html.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFileType.mockResolvedValue({ mime: 'text/html', ext: 'html' } as any)

    const { processor, mocks } = makeProcessor({})

    await processor.process(makeJob(makeJobData({ declaredMime: 'image/jpeg', fileName: 'photo.jpg' })))

    expect(mocks.mockQuarantineFile).toHaveBeenCalledOnce()
    expect(mocks.mockUpdateFileStatus).toHaveBeenCalledWith(
      BASE_FILE_ID, 'quarantined',
      expect.objectContaining({ reason: 'mime_mismatch' }),
    )
    expect(mocks.mockPublish).toHaveBeenCalledWith(
      `ingest.file.quarantined:${BASE_PROJECT_ID}`,
      expect.objectContaining({ reason: 'mime_mismatch' }),
    )
    expect(mocks.mockScanWithClamAv).not.toHaveBeenCalled()
    expect(mocks.mockPromoteFile).not.toHaveBeenCalled()
  })

  // ── 7. ClamAV down ────────────────────────────────────────────────────────
  it('7. ClamAV down — job throws (BullMQ retries), no DB update', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFileType.mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' } as any)

    const { processor, mocks } = makeProcessor({ scanResult: 'down' })

    await expect(processor.process(makeJob(makeJobData({ declaredMime: 'application/pdf' }))))
      .rejects.toThrow(ClamAvDownError)

    // No clean or quarantined DB update
    expect(mocks.mockUpdateFileStatus).not.toHaveBeenCalledWith(expect.anything(), 'clean', expect.anything())
    expect(mocks.mockUpdateFileStatus).not.toHaveBeenCalledWith(expect.anything(), 'quarantined', expect.anything())
    expect(mocks.mockPromoteFile).not.toHaveBeenCalled()
    expect(mocks.mockQuarantineFile).not.toHaveBeenCalled()
  })

  // ── 8. Clean PDF (happy path) ─────────────────────────────────────────────
  it('8. Clean PDF — full gate passes → clean', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFileType.mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' } as any)

    const pdfBuffer = Buffer.from('%PDF-1.7 clean document')
    const disarmedBuffer = Buffer.from('%PDF-1.7 reserialized')
    const mockPdfDisarmer = vi
      .fn<(b: Buffer, m: string) => Promise<Buffer>>()
      .mockResolvedValue(disarmedBuffer)

    const { processor, mocks } = makeProcessor({
      downloadBuffer: pdfBuffer,
      disarmers: new Map<string, Disarmer>([['application/pdf', mockPdfDisarmer]]),
    })

    await processor.process(makeJob(makeJobData({ declaredMime: 'application/pdf', fileName: 'clean.pdf' })))

    expect(mocks.mockDownloadFile).toHaveBeenCalledOnce()
    expect(mocks.mockScanWithClamAv).toHaveBeenCalledOnce()
    expect(mockPdfDisarmer).toHaveBeenCalledOnce()
    expect(mocks.mockPromoteFile).toHaveBeenCalledWith(
      `${BASE_PROJECT_ID}/${BASE_FILE_ID}/clean.pdf`,
      disarmedBuffer,
      BASE_STORAGE_KEY,
      'application/pdf',
    )
    expect(mocks.mockUpdateFileStatus).toHaveBeenCalledWith(
      BASE_FILE_ID, 'clean', { verdict: 'clean', disarmed: true },
    )
    expect(mocks.mockPublish).toHaveBeenCalledWith(
      `ingest.file.clean:${BASE_PROJECT_ID}`,
      expect.objectContaining({
        storageKey: `clean/${BASE_PROJECT_ID}/${BASE_FILE_ID}/clean.pdf`,
      }),
    )
    expect(mocks.mockQuarantineFile).not.toHaveBeenCalled()
  })

  // ── 9. File too large ─────────────────────────────────────────────────────
  it('9. File too large — failed before S3 download', async () => {
    const maxBytes = 1024
    const { processor, mocks } = makeProcessor({ maxFileBytes: maxBytes })

    await processor.process(makeJob(makeJobData({ sizeBytes: maxBytes + 1, declaredMime: 'application/pdf' })))

    expect(mocks.mockDownloadFile).not.toHaveBeenCalled()
    expect(mocks.mockUpdateFileStatus).toHaveBeenCalledWith(
      BASE_FILE_ID, 'failed',
      expect.objectContaining({ reason: 'file_too_large' }),
    )
    expect(mocks.mockPublish).toHaveBeenCalledWith(
      `ingest.file.failed:${BASE_PROJECT_ID}`,
      expect.objectContaining({ reason: 'file_too_large' }),
    )
    expect(mocks.mockQuarantineFile).not.toHaveBeenCalled()
    expect(mocks.mockPromoteFile).not.toHaveBeenCalled()
  })

  // ── 10. CSV formula injection ─────────────────────────────────────────────
  it('10. CSV formula injection — sanitized, promoted clean, disarmed=true', async () => {
    // CSV has no magic bytes
    mockFileType.mockResolvedValue(undefined)

    const csvInput = Buffer.from('name,amount\n=SUM(A1:B1),100\n+EXPLOIT,200')
    const csvSanitized = Buffer.from("name,amount\n'=SUM(A1:B1),100\n'+EXPLOIT,200")
    const mockCsvDisarmer = vi
      .fn<(b: Buffer, m: string) => Promise<Buffer>>()
      .mockResolvedValue(csvSanitized)

    const { processor, mocks } = makeProcessor({
      downloadBuffer: csvInput,
      disarmers: new Map<string, Disarmer>([['text/csv', mockCsvDisarmer]]),
    })

    await processor.process(makeJob(makeJobData({ declaredMime: 'text/csv', fileName: 'data.csv' })))

    expect(mockCsvDisarmer).toHaveBeenCalledWith(csvInput, 'text/csv')
    expect(mocks.mockPromoteFile).toHaveBeenCalledWith(
      `${BASE_PROJECT_ID}/${BASE_FILE_ID}/data.csv`,
      csvSanitized,
      BASE_STORAGE_KEY,
      'text/csv',
    )
    expect(mocks.mockUpdateFileStatus).toHaveBeenCalledWith(
      BASE_FILE_ID, 'clean',
      expect.objectContaining({ disarmed: true }),
    )
    expect(mocks.mockPublish).toHaveBeenCalledWith(
      `ingest.file.clean:${BASE_PROJECT_ID}`,
      expect.objectContaining({ scanReport: { verdict: 'clean', disarmed: true } }),
    )
    expect(mocks.mockQuarantineFile).not.toHaveBeenCalled()
  })
})

// ── Disarmer unit tests ───────────────────────────────────────────────────────

describe('CSV disarmer', () => {
  it('strips formula injection from cells', async () => {
    const { disarmCsv } = await import('./steps/disarm/csv.js')

    const input = Buffer.from('name,value\n=MALICIOUS,safe\n+BAD,-OK\n@INJECT,normal')
    const result = await disarmCsv(input, 'text/csv')
    const output = result.toString('utf-8')

    expect(output).toContain("'=MALICIOUS")
    expect(output).toContain("'+BAD")
    expect(output).toContain("'@INJECT")
    expect(output).toContain('safe')
    expect(output).toContain('normal')
    // '-OK' starts with '-' — should be sanitized
    expect(output).toContain("'-OK")
  })

  it('leaves safe cells unchanged', async () => {
    const { disarmCsv } = await import('./steps/disarm/csv.js')

    const input = Buffer.from('name,value\nAlice,100\nBob,200')
    const result = await disarmCsv(input, 'text/csv')
    expect(result.toString('utf-8')).toBe('name,value\nAlice,100\nBob,200')
  })
})

describe('Size check', () => {
  it('returns ok=false when sizeBytes exceeds max', async () => {
    const { checkSize } = await import('./steps/size-check.js')
    expect(checkSize(100 * 1024 * 1024 + 1, 100 * 1024 * 1024).ok).toBe(false)
  })

  it('returns ok=true when sizeBytes is at the limit', async () => {
    const { checkSize } = await import('./steps/size-check.js')
    expect(checkSize(100 * 1024 * 1024, 100 * 1024 * 1024).ok).toBe(true)
  })
})

describe('Allowlist check', () => {
  it('allows known safe MIMEs', async () => {
    const { checkAllowlist } = await import('./steps/allowlist-check.js')
    expect(checkAllowlist('application/pdf').ok).toBe(true)
    expect(checkAllowlist('image/jpeg').ok).toBe(true)
    expect(checkAllowlist('text/csv').ok).toBe(true)
    expect(checkAllowlist('image/svg+xml').ok).toBe(true)
  })

  it('rejects unknown MIMEs', async () => {
    const { checkAllowlist } = await import('./steps/allowlist-check.js')
    expect(checkAllowlist('image/gif').ok).toBe(false)
    expect(checkAllowlist('application/x-sh').ok).toBe(false)
    expect(checkAllowlist('text/html').ok).toBe(false)
  })
})

describe('Magic check', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes for text-like MIMEs without magic bytes', async () => {
    const { checkMagic } = await import('./steps/magic-check.js')
    mockFileType.mockResolvedValue(undefined)
    const result = await checkMagic(Buffer.from('Hello, world'), 'text/plain')
    expect(result.ok).toBe(true)
  })

  it('passes when detected MIME class matches declared image class', async () => {
    const { checkMagic } = await import('./steps/magic-check.js')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFileType.mockResolvedValue({ mime: 'image/png', ext: 'png' } as any)
    const result = await checkMagic(Buffer.from('fakeimg'), 'image/jpeg')
    expect(result.ok).toBe(true)
  })

  it('rejects when detected MIME class differs (image vs application)', async () => {
    const { checkMagic } = await import('./steps/magic-check.js')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFileType.mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' } as any)
    const result = await checkMagic(Buffer.from('fakegif'), 'image/gif')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('mime_mismatch')
  })

  it('rejects when binary MIME declared but nothing detected', async () => {
    const { checkMagic } = await import('./steps/magic-check.js')
    mockFileType.mockResolvedValue(undefined)
    const result = await checkMagic(Buffer.from('random'), 'application/pdf')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('undetectable')
  })
})
