import { Injectable, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { eq, and } from 'drizzle-orm';
import { withTenant, files } from '@bramha/db';
import { eventBus } from '@bramha/event-bus';
import type { FileDto, FileStatus } from '@bramha/shared';

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
]);

const MAX_BYTES = 25 * 1024 * 1024;

function getUploadsDir(): string {
  return process.env['UPLOADS_DIR'] ?? './uploads';
}

function sanitizeFilename(name: string): string {
  // Strip path separators, null bytes, and dot-dot sequences, limit to 255 chars
  return name
    .replace(/[/\\]/g, '_')
    .replace(/\0/g, '')
    .replace(/\.\./g, '')
    .slice(0, 255)
    .trim() || 'upload';
}

function rowToDto(row: {
  id: string;
  projectId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  errorMsg: string | null;
  createdAt: Date;
  uploadedBy: string;
}): FileDto {
  return {
    id: row.id,
    projectId: row.projectId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status as FileStatus,
    chunkCount: null, // populated by ingestion pipeline; not stored on files table
    errorMsg: row.errorMsg,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.uploadedBy,
  };
}

@Injectable()
export class FilesService {
  async uploadFile(params: {
    projectId: string;
    userId: string;
    filename: string;
    buffer: Buffer;
    size: number;
  }): Promise<FileDto> {
    const { projectId, userId, filename, buffer, size } = params;

    // 1. Size check
    if (size > MAX_BYTES) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', title: 'File too large' });
    }

    // 2. Magic-byte MIME detection (lazy import — ESM-only package)
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(buffer);

    // For plain text / markdown / csv, file-type may return undefined (no magic bytes)
    // Allow them only if no magic bytes are detected (detected === undefined)
    if (detected !== undefined && !ALLOWED_MIMES.has(detected.mime)) {
      throw new BadRequestException({ code: 'UNSUPPORTED_FILE_TYPE', title: 'Unsupported file type' });
    }

    // Resolve detected MIME: if magic bytes found, use it; else default to text/plain
    const resolvedMime = detected?.mime ?? 'text/plain';

    // 3. Sanitize filename
    const safeFilename = sanitizeFilename(filename);

    // 4. Generate storage path
    const storagePath = `${projectId}/${randomUUID()}_${safeFilename}`;

    // 5. Resolve uploads dir to absolute and validate path (Bug 3: path traversal)
    const resolvedUploadsDir = path.resolve(getUploadsDir());
    const fullDir = path.join(resolvedUploadsDir, projectId);
    const fullPath = path.join(resolvedUploadsDir, storagePath);
    if (!fullPath.startsWith(resolvedUploadsDir + path.sep) && fullPath !== resolvedUploadsDir) {
      throw new BadRequestException({ code: 'INVALID_PATH', title: 'Invalid path' });
    }

    // 6. Insert DB row FIRST (Bug 1: write-after-insert order)
    const [row] = await withTenant({ projectId, userId }, async (db) => {
      return db
        .insert(files)
        .values({
          projectId,
          uploadedBy: userId,
          filename: safeFilename,
          mimeType: resolvedMime,
          sizeBytes: size,
          storagePath,
          status: 'pending',
        })
        .returning();
    });

    if (!row) throw new Error('insert failed');

    // 7. Write file to disk; compensate by deleting DB row if write fails
    try {
      await fs.mkdir(fullDir, { recursive: true });
      await fs.writeFile(fullPath, buffer);
    } catch {
      // Compensating delete: remove the DB row we just inserted
      await withTenant({ projectId, userId }, async (db) => {
        return db
          .delete(files)
          .where(and(eq(files.id, row.id), eq(files.projectId, projectId)));
      });
      throw new InternalServerErrorException({ code: 'FILE_WRITE_FAILED', title: 'File write failed' });
    }

    // 8. Emit file:status event
    eventBus.emit({ type: 'file.status', projectId, fileId: row.id, status: 'pending' });

    return rowToDto(row);
  }

  async listFiles(projectId: string, userId: string): Promise<FileDto[]> {
    const rows = await withTenant({ projectId, userId }, async (db) => {
      return db
        .select()
        .from(files)
        .where(eq(files.projectId, projectId));
    });

    return rows.map(rowToDto);
  }

  async deleteFile(projectId: string, fileId: string, userId: string): Promise<void> {
    // 1. Fetch to verify ownership / existence
    const [row] = await withTenant({ projectId, userId }, async (db) => {
      return db
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.projectId, projectId)));
    });

    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'File not found' });
    }

    // 2. Resolve uploads dir to absolute and validate path (Bug 3: path traversal)
    const resolvedUploadsDir = path.resolve(getUploadsDir());
    const fullPath = path.join(resolvedUploadsDir, row.storagePath);
    if (!fullPath.startsWith(resolvedUploadsDir + path.sep) && fullPath !== resolvedUploadsDir) {
      throw new BadRequestException({ code: 'INVALID_PATH', title: 'Invalid path' });
    }

    // 3. Delete from disk (swallow ENOENT)
    await fs.unlink(fullPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });

    // 4. Delete DB row
    await withTenant({ projectId, userId }, async (db) => {
      return db
        .delete(files)
        .where(and(eq(files.id, fileId), eq(files.projectId, projectId)));
    });
  }
}
