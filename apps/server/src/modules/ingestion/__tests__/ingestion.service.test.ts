/**
 * Unit tests for IngestionService and chunkText.
 * Mocks: getDb, getModelRouter, pdf-parse, mammoth, node:fs/promises, @bramha/event-bus
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before module under test is imported
// ---------------------------------------------------------------------------

// Mock @bramha/db
vi.mock('@bramha/db', () => ({
  getDb: vi.fn(),
  claimIngestionJob: vi.fn(),
  files: {},
  fileChunks: {},
  ingestionJobs: {},
}));

// Mock drizzle-orm sql tag (used in the service's raw queries)
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, __isSql: true }),
    eq: actual.eq,
  };
});

// Mock @bramha/agents
vi.mock('@bramha/agents', () => ({
  getModelRouter: vi.fn(),
}));

// Mock @bramha/event-bus
vi.mock('@bramha/event-bus', () => ({
  eventBus: { emit: vi.fn() },
}));

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

// Mock pdf-parse
vi.mock('pdf-parse', () => ({
  default: vi.fn(),
}));

// Mock mammoth
vi.mock('mammoth', () => ({
  default: { extractRawText: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import { chunkText, IngestionService } from '../ingestion.service.js';
import { getDb, claimIngestionJob } from '@bramha/db';
import { getModelRouter } from '@bramha/agents';
import { eventBus } from '@bramha/event-bus';
import * as fsPromises from 'node:fs/promises';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

const mockedGetDb = vi.mocked(getDb);
const mockedClaimIngestionJob = vi.mocked(claimIngestionJob);
const mockedGetModelRouter = vi.mocked(getModelRouter);
const mockedEventBusEmit = vi.mocked(eventBus.emit);
const mockedReadFile = vi.mocked(fsPromises.readFile);
const mockedPdfParse = vi.mocked(pdfParse);
const mockedMammoth = vi.mocked(mammoth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(overrides: Record<string, unknown> = {}) {
  const executeResults: unknown[] = [];
  const db = {
    _executeQueue: executeResults,
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    ...overrides,
  };
  // Make select().from().where() chain work
  db.select.mockReturnValue({ from: db.from });
  db.from.mockReturnValue({ where: db.where });
  db.update.mockReturnValue({ set: db.set });
  db.set.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
  return db;
}

// ---------------------------------------------------------------------------
// chunkText tests
// ---------------------------------------------------------------------------

describe('chunkText', () => {
  it('preserves short text as a single chunk', () => {
    const text = 'Hello, world! This is a short text.';
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it('splits long text into multiple chunks of ~800 tokens', () => {
    // 800 tokens * 4 chars/token = 3200 chars max per chunk
    // Create text > 6400 chars so we get at least 3 chunks
    const sentence = 'The quick brown fox jumps over the lazy dog. ';
    const longText = sentence.repeat(200); // ~9000 chars
    const chunks = chunkText(longText);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be within 800 tokens with overlap
    // (overlap can push it a bit over, but the content part is ≤ 3200 chars)
    // The raw content portions should all be reasonable
    expect(chunks[0]!.length).toBeLessThanOrEqual(3200 * 1.2); // allow 20% for overlap
  });

  it('adds overlap from previous chunk to subsequent chunks', () => {
    // 800 tokens * 4 chars = 3200 chars; 15% overlap = 480 chars
    // Use paragraph breaks to force multiple sections, each < maxChars but together > maxChars
    // Two paragraphs of 2000 chars each → forces split since (2000+2000) > 3200
    const para = 'The quick brown fox jumps over the lazy dog. '.repeat(44); // ~2000 chars
    const text = para + '\n\n' + para; // two paragraphs
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    if (chunks.length >= 2) {
      // The second chunk should start with the last portion of the first chunk
      const firstChunk = chunks[0]!;
      const secondChunk = chunks[1]!;
      const expectedOverlapLen = Math.floor(3200 * 0.15);
      const overlap = firstChunk.slice(-expectedOverlapLen);
      // Second chunk should contain the overlap content
      expect(secondChunk).toContain(overlap.trim().slice(0, 20)); // check first 20 chars of overlap
    }
  });
});

// ---------------------------------------------------------------------------
// IngestionService tests
// ---------------------------------------------------------------------------

describe('IngestionService', () => {
  let service: IngestionService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IngestionService();
    db = makeDb();
    mockedGetDb.mockResolvedValue(db as never);
    // Default: no job to claim
    mockedClaimIngestionJob.mockResolvedValue(null);
  });

  // 4. No-op when no jobs available
  it('processNextJob: no-op when no jobs available', async () => {
    // claimIngestionJob returns null → nothing to process
    mockedClaimIngestionJob.mockResolvedValue(null);

    await expect(service.processNextJob()).resolves.toBeUndefined();
    // No DB execute calls should have happened
    expect(db.execute).not.toHaveBeenCalled();
  });

  // 5. Full happy path
  it('processJob: extracts text, chunks, embeds, inserts chunks, marks file ready', async () => {
    const fileId = 'file-uuid-1';
    const projectId = 'proj-uuid-1';
    const jobId = 'job-uuid-1';

    // claimIngestionJob returns a job
    mockedClaimIngestionJob.mockResolvedValue({
      id: jobId, fileId, projectId, attempt: 1,
      status: 'running', errorMsg: null,
      queuedAt: new Date(), startedAt: new Date(), finishedAt: null,
    });
    // execute calls (insert chunk, mark done) return empty
    db.execute.mockResolvedValue({ rows: [] });

    // db.select().from().where() returns the file row
    const fileRow = {
      id: fileId,
      projectId,
      mimeType: 'text/plain',
      storagePath: `${projectId}/uuid_test.txt`,
      status: 'pending',
      filename: 'test.txt',
    };
    db.where.mockResolvedValue([fileRow]);

    // fs.readFile returns text content
    const content = 'Hello from test file. This is the content.';
    mockedReadFile.mockResolvedValue(Buffer.from(content) as never);

    // Embeddings
    const fakeEmbedding = [0.1, 0.2, 0.3];
    const mockEmbed = vi.fn().mockResolvedValue([fakeEmbedding]);
    mockedGetModelRouter.mockReturnValue({ embed: mockEmbed } as never);

    // db.update().set().where() for files.status = 'ready'
    const mockWhere = vi.fn().mockResolvedValue([]);
    db.set.mockReturnValue({ where: mockWhere });

    await service.processNextJob();

    // Should have embedded
    expect(mockEmbed).toHaveBeenCalledWith(expect.objectContaining({ projectId, inputs: expect.any(Array) }));

    // Should have inserted chunk
    const insertCalls = db.execute.mock.calls.filter((args) => {
      const arg = args[0] as { strings?: string[] };
      return arg?.strings?.some((s: string) => s.includes('INSERT INTO file_chunks'));
    });
    expect(insertCalls.length).toBeGreaterThan(0);

    // Should have updated files to ready
    expect(db.update).toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }));

    // Should emit ready event
    expect(mockedEventBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'file.status', status: 'ready', projectId, fileId }),
    );
  });

  // 6. Retry on error when attempt < 3
  it('handleJobError: sets status back to pending when attempt < 3', async () => {
    const jobId = 'job-uuid-2';
    const fileId = 'file-uuid-2';
    const projectId = 'proj-uuid-2';

    // claimIngestionJob returns job with attempt=1
    mockedClaimIngestionJob.mockResolvedValue({
      id: jobId, fileId, projectId, attempt: 1,
      status: 'running', errorMsg: null,
      queuedAt: new Date(), startedAt: new Date(), finishedAt: null,
    });
    db.execute.mockResolvedValue({ rows: [] });

    // File read succeeds but embed throws
    const fileRow = { id: fileId, projectId, mimeType: 'text/plain', storagePath: `${projectId}/f.txt`, status: 'pending', filename: 'f.txt' };
    db.where.mockResolvedValue([fileRow]);
    mockedReadFile.mockResolvedValue(Buffer.from('some text') as never);
    const mockEmbed = vi.fn().mockRejectedValue(new Error('embed failed'));
    mockedGetModelRouter.mockReturnValue({ embed: mockEmbed } as never);
    db.set.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });

    await service.processNextJob();

    // Should have set back to pending (retry)
    const pendingUpdateCall = db.execute.mock.calls.find((args) => {
      const arg = args[0] as { strings?: string[] };
      return arg?.strings?.some((s: string) => s.includes("'pending'"));
    });
    expect(pendingUpdateCall).toBeDefined();
    // Should NOT have emitted an error event
    expect(mockedEventBusEmit).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' }),
    );
  });

  // 7. Permanent failure after 3 attempts
  it('handleJobError: marks failed after 3 attempts, sets file status = error', async () => {
    const jobId = 'job-uuid-3';
    const fileId = 'file-uuid-3';
    const projectId = 'proj-uuid-3';

    // claimIngestionJob returns job with attempt=3 (already hit the limit)
    mockedClaimIngestionJob.mockResolvedValue({
      id: jobId, fileId, projectId, attempt: 3,
      status: 'running', errorMsg: null,
      queuedAt: new Date(), startedAt: new Date(), finishedAt: null,
    });
    db.execute.mockResolvedValue({ rows: [] });

    const fileRow = { id: fileId, projectId, mimeType: 'text/plain', storagePath: `${projectId}/f.txt`, status: 'pending', filename: 'f.txt' };
    db.where.mockResolvedValue([fileRow]);
    mockedReadFile.mockResolvedValue(Buffer.from('some text') as never);
    const mockEmbed = vi.fn().mockRejectedValue(new Error('permanent failure'));
    mockedGetModelRouter.mockReturnValue({ embed: mockEmbed } as never);

    const mockUpdateWhere = vi.fn().mockResolvedValue([]);
    db.set.mockReturnValue({ where: mockUpdateWhere });

    await service.processNextJob();

    // Should have set job to failed
    const failedUpdateCall = db.execute.mock.calls.find((args) => {
      const arg = args[0] as { strings?: string[] };
      return arg?.strings?.some((s: string) => s.includes("'failed'"));
    });
    expect(failedUpdateCall).toBeDefined();

    // Should have updated file status to error
    expect(db.update).toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' }),
    );

    // Should emit error event
    expect(mockedEventBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'file.status', status: 'error', projectId, fileId }),
    );
  });

  // PDF extraction
  it('extractText: parses PDF via pdf-parse', async () => {
    const jobId = 'job-pdf';
    const fileId = 'file-pdf';
    const projectId = 'proj-pdf';

    mockedClaimIngestionJob.mockResolvedValue({
      id: jobId, fileId, projectId, attempt: 1,
      status: 'running', errorMsg: null,
      queuedAt: new Date(), startedAt: new Date(), finishedAt: null,
    });
    db.execute.mockResolvedValue({ rows: [] });

    const fileRow = { id: fileId, projectId, mimeType: 'application/pdf', storagePath: `${projectId}/doc.pdf`, status: 'pending', filename: 'doc.pdf' };
    db.where.mockResolvedValue([fileRow]);
    mockedReadFile.mockResolvedValue(Buffer.from('%PDF') as never);
    mockedPdfParse.mockResolvedValue({ text: 'Extracted PDF text.' } as never);

    const mockEmbed = vi.fn().mockResolvedValue([[0.1, 0.2]]);
    mockedGetModelRouter.mockReturnValue({ embed: mockEmbed } as never);
    db.set.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });

    await service.processNextJob();

    expect(mockedPdfParse).toHaveBeenCalled();
    expect(mockEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: expect.arrayContaining(['Extracted PDF text.']) }),
    );
  });

  // DOCX extraction
  it('extractText: parses DOCX via mammoth', async () => {
    const jobId = 'job-docx';
    const fileId = 'file-docx';
    const projectId = 'proj-docx';

    mockedClaimIngestionJob.mockResolvedValue({
      id: jobId, fileId, projectId, attempt: 1,
      status: 'running', errorMsg: null,
      queuedAt: new Date(), startedAt: new Date(), finishedAt: null,
    });
    db.execute.mockResolvedValue({ rows: [] });

    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const fileRow = { id: fileId, projectId, mimeType: docxMime, storagePath: `${projectId}/doc.docx`, status: 'pending', filename: 'doc.docx' };
    db.where.mockResolvedValue([fileRow]);
    mockedReadFile.mockResolvedValue(Buffer.from('docx-bytes') as never);
    mockedMammoth.extractRawText.mockResolvedValue({ value: 'Extracted DOCX text.', messages: [] });

    const mockEmbed = vi.fn().mockResolvedValue([[0.1, 0.2]]);
    mockedGetModelRouter.mockReturnValue({ embed: mockEmbed } as never);
    db.set.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });

    await service.processNextJob();

    expect(mockedMammoth.extractRawText).toHaveBeenCalled();
    expect(mockEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: expect.arrayContaining(['Extracted DOCX text.']) }),
    );
  });
});
