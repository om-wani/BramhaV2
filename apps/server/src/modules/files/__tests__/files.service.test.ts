/**
 * Unit tests for FilesService.
 * All external dependencies (DB, file-type, fs, event-bus) are mocked.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module under test is imported
// ---------------------------------------------------------------------------

// Mock @bramha/db
vi.mock('@bramha/db', () => ({
  withTenant: vi.fn(),
  files: {},
}));

// Mock @bramha/event-bus
vi.mock('@bramha/event-bus', () => ({
  eventBus: { emit: vi.fn() },
}));

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

// Mock file-type (ESM dynamic import)
vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks are in place
// ---------------------------------------------------------------------------
import { FilesService } from '../files.service.js';
import { withTenant } from '@bramha/db';
import { eventBus } from '@bramha/event-bus';
import { fileTypeFromBuffer } from 'file-type';

const mockedWithTenant = vi.mocked(withTenant);
const mockedFileTypeFromBuffer = vi.mocked(fileTypeFromBuffer);
const mockedEventBusEmit = vi.mocked(eventBus.emit);

// Fake DB row returned by insert
function makeFileRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'file-uuid-123',
    projectId: 'proj-1',
    uploadedBy: 'user-1',
    filename: 'test.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    storagePath: 'proj-1/uuid_test.pdf',
    status: 'pending',
    errorMsg: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('FilesService', () => {
  let service: FilesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FilesService();

    // Default: withTenant resolves with a fake inserted row
    mockedWithTenant.mockImplementation(async (_ctx, fn) => {
      const fakeDb = {
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([makeFileRow()]),
          }),
        }),
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([makeFileRow()]),
          }),
        }),
        delete: () => ({
          where: () => Promise.resolve(),
        }),
      };
      return fn(fakeDb as never, _ctx);
    });
  });

  // 1. Rejects files > 25 MB
  it('rejects files > 25MB', async () => {
    const oversizedBuffer = Buffer.alloc(1);
    await expect(
      service.uploadFile({
        projectId: 'proj-1',
        userId: 'user-1',
        filename: 'big.pdf',
        buffer: oversizedBuffer,
        size: 26 * 1024 * 1024,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // 2. Rejects unsupported MIME — fake PDF with wrong magic bytes
  it('rejects unsupported MIME types (fake PDF with wrong magic bytes)', async () => {
    // file-type detects it as an image/png (wrong magic bytes)
    mockedFileTypeFromBuffer.mockResolvedValueOnce({ ext: 'png', mime: 'image/png' });

    const fakeBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes

    await expect(
      service.uploadFile({
        projectId: 'proj-1',
        userId: 'user-1',
        filename: 'evil.pdf',
        buffer: fakeBuffer,
        size: fakeBuffer.length,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // 3. Accepts valid PDF (magic bytes %PDF → application/pdf)
  it('accepts valid PDF (magic bytes %PDF)', async () => {
    mockedFileTypeFromBuffer.mockResolvedValueOnce({ ext: 'pdf', mime: 'application/pdf' });

    const pdfMagic = Buffer.from('%PDF-1.4', 'ascii');

    const result = await service.uploadFile({
      projectId: 'proj-1',
      userId: 'user-1',
      filename: 'document.pdf',
      buffer: pdfMagic,
      size: pdfMagic.length,
    });

    expect(result.mimeType).toBe('application/pdf');
    expect(result.status).toBe('pending');
    expect(result.id).toBe('file-uuid-123');
  });

  // 4. Sanitizes filename — strips ../ and path separators
  it('sanitizes filename (strips ../ and path separators)', async () => {
    mockedFileTypeFromBuffer.mockResolvedValueOnce({ ext: 'pdf', mime: 'application/pdf' });

    // Capture what was passed to insert via withTenant mock
    let capturedValues: Record<string, unknown> | null = null;
    mockedWithTenant.mockImplementation(async (_ctx, fn) => {
      const fakeDb = {
        insert: () => ({
          values: (vals: Record<string, unknown>) => {
            capturedValues = vals;
            return {
              returning: () => Promise.resolve([makeFileRow({ filename: vals['filename'] as string })]),
            };
          },
        }),
      };
      return fn(fakeDb as never, _ctx);
    });

    const buf = Buffer.from('%PDF-1.4', 'ascii');
    await service.uploadFile({
      projectId: 'proj-1',
      userId: 'user-1',
      filename: '../../etc/passwd',
      buffer: buf,
      size: buf.length,
    });

    // Filename should not contain path separators
    expect(capturedValues).not.toBeNull();
    const savedName = capturedValues!['filename'] as string;
    expect(savedName).not.toContain('/');
    expect(savedName).not.toContain('\\');
    expect(savedName).not.toContain('..');
  });

  // 5. Emits file:status pending on successful upload
  it('emits file:status pending on successful upload', async () => {
    mockedFileTypeFromBuffer.mockResolvedValueOnce({ ext: 'pdf', mime: 'application/pdf' });

    const buf = Buffer.from('%PDF-1.4', 'ascii');
    await service.uploadFile({
      projectId: 'proj-1',
      userId: 'user-1',
      filename: 'test.pdf',
      buffer: buf,
      size: buf.length,
    });

    expect(mockedEventBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'file.status',
        projectId: 'proj-1',
        status: 'pending',
      }),
    );
  });
});
