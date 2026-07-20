import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb, files, claimIngestionJob } from '@bramha/db';
import { getModelRouter } from '@bramha/agents';
import { eventBus } from '@bramha/event-bus';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

// ---------------------------------------------------------------------------
// chunkText — exported for unit tests
// ---------------------------------------------------------------------------

export function chunkText(text: string, maxTokens = 800, overlapRatio = 0.15): string[] {
  const maxChars = maxTokens * 4;
  const overlapChars = Math.floor(maxChars * overlapRatio);

  // Split on paragraph breaks and headings
  const sections = text.split(/\n(?=#{1,6} |\n)/);

  const chunks: string[] = [];
  let current = '';

  for (const section of sections) {
    if ((current + section).length <= maxChars) {
      current += (current ? '\n\n' : '') + section;
    } else {
      if (current) chunks.push(current.trim());
      if (section.length > maxChars) {
        // Split by sentences
        const sentences = section.match(/[^.!?]+[.!?]+/g) ?? [section];
        current = '';
        for (const s of sentences) {
          if ((current + s).length <= maxChars) {
            current += s;
          } else {
            if (current) chunks.push(current.trim());
            current = s;
          }
        }
      } else {
        current = section;
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Add overlap: prepend last N chars of previous chunk to each subsequent chunk
  const chunksWithOverlap: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      chunksWithOverlap.push(chunks[i]!);
    } else {
      const prev = chunks[i - 1]!;
      const overlap = prev.slice(-overlapChars);
      chunksWithOverlap.push(overlap + '\n\n' + chunks[i]!);
    }
  }
  return chunksWithOverlap;
}

// ---------------------------------------------------------------------------
// IngestionService
// ---------------------------------------------------------------------------

type ClaimedJob = {
  id: string;
  fileId: string;
  projectId: string;
  attempt: number;
};

@Injectable()
export class IngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionService.name);
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  onModuleInit(): void {
    this.startPoller();
  }

  onModuleDestroy(): void {
    this.stopPoller();
  }

  private startPoller(): void {
    this.pollInterval = setInterval(() => {
      void this.processNextJob();
    }, 5000);
  }

  private stopPoller(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async processNextJob(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      const job = await this.claimNextJob();
      if (!job) return;
      await this.processJob(job);
    } finally {
      this.processing = false;
    }
  }

  private async claimNextJob(): Promise<ClaimedJob | null> {
    const job = await claimIngestionJob();
    if (!job) return null;
    return { id: job.id, fileId: job.fileId, projectId: job.projectId, attempt: job.attempt };
  }

  private async extractText(buffer: Buffer, mimeType: string): Promise<string> {
    switch (mimeType) {
      case 'application/pdf': {
        const data = await pdfParse(buffer);
        return data.text;
      }
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      }
      case 'text/plain':
      case 'text/markdown':
      case 'text/csv':
        return buffer.toString('utf-8');
      default:
        throw new Error(`Unsupported MIME type: ${mimeType}`);
    }
  }

  private async processJob(job: ClaimedJob): Promise<void> {
    try {
      const db = await getDb();

      // 1. Get file info
      const [fileRow] = await db.select().from(files).where(eq(files.id, job.fileId));
      if (!fileRow) throw new Error(`File not found: ${job.fileId}`);

      // 1a. Mark file as processing so UI reflects in-progress state
      await db.update(files).set({ status: 'processing' }).where(eq(files.id, job.fileId));
      eventBus.emit({ type: 'file.status', projectId: job.projectId, fileId: job.fileId, status: 'processing' });

      // 2. Read file bytes
      const uploadsDir = path.resolve(process.env['UPLOADS_DIR'] ?? './uploads');
      const fullPath = path.join(uploadsDir, fileRow.storagePath);
      const buffer = await fs.readFile(fullPath);

      // 3. Extract text
      const text = await this.extractText(buffer, fileRow.mimeType);

      // 4. Chunk text
      const chunks = chunkText(text);
      if (chunks.length === 0) chunks.push(text.trim() || '(empty)');

      // 5. Batch embed
      const embeddings = await getModelRouter().embed({
        projectId: job.projectId,
        inputs: chunks,
      });

      // 6. Insert file_chunks (raw SQL for ::vector cast)
      for (let i = 0; i < chunks.length; i++) {
        const embedding = embeddings[i];
        if (!embedding) continue;
        await db.execute(sql`
          INSERT INTO file_chunks (id, file_id, project_id, chunk_index, content, embedding)
          VALUES (gen_random_uuid(), ${job.fileId}, ${job.projectId}, ${i}, ${chunks[i]}, ${JSON.stringify(embedding)}::vector)
        `);
      }

      // 7. Update files.status = 'ready'
      await db.update(files).set({ status: 'ready' }).where(eq(files.id, job.fileId));

      // 8. Mark job done
      await db.execute(sql`
        UPDATE ingestion_jobs
        SET status = 'done', updated_at = NOW(), finished_at = NOW()
        WHERE id = ${job.id}
      `);

      // 9. Emit ready event
      eventBus.emit({ type: 'file.status', projectId: job.projectId, fileId: job.fileId, status: 'ready' });

      this.logger.log(`Job ${job.id} completed: ${chunks.length} chunks for file ${job.fileId}`);
    } catch (err) {
      await this.handleJobError(job, err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async handleJobError(job: ClaimedJob, err: Error): Promise<void> {
    try {
      const db = await getDb();
      // job.attempt is already the incremented value (set by claimNextJob)
      if (job.attempt < 3) {
        // Retry: set back to pending
        await db.execute(sql`
          UPDATE ingestion_jobs
          SET status = 'pending', updated_at = NOW()
          WHERE id = ${job.id}
        `);
        this.logger.warn(`Job ${job.id} attempt ${job.attempt} failed, will retry: ${err.message}`);
      } else {
        // Permanently failed
        await db.execute(sql`
          UPDATE ingestion_jobs
          SET status = 'failed', updated_at = NOW(), finished_at = NOW(), error_msg = ${err.message}
          WHERE id = ${job.id}
        `);
        await db.update(files)
          .set({ status: 'error', errorMsg: err.message.slice(0, 500) })
          .where(eq(files.id, job.fileId));
        eventBus.emit({ type: 'file.status', projectId: job.projectId, fileId: job.fileId, status: 'error' });
        this.logger.error(`Job ${job.id} permanently failed after ${job.attempt} attempts: ${err.message}`);
      }
    } catch (handlerErr) {
      this.logger.error(
        `handleJobError itself failed for job ${job.id} (stuck in running): ${String(handlerErr)}`,
      );
    }
  }
}
