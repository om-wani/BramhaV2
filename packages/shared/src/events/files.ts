import { z } from 'zod'
import { uuidSchema } from '../schemas/common.js'

// ── ingest.extraction.done ────────────────────────────────────────────────────

export const ExtractionDonePayloadSchema = z
  .object({
    fileId: uuidSchema,
    projectId: uuidSchema,
    chunkCount: z.number().int().nonnegative(),
  })
  .strict()

export type ExtractionDonePayload = z.infer<typeof ExtractionDonePayloadSchema>

// ── ingest.extraction.failed ──────────────────────────────────────────────────

export const ExtractionFailedPayloadSchema = z
  .object({
    fileId: uuidSchema,
    projectId: uuidSchema,
    reason: z.string().min(1),
  })
  .strict()

export type ExtractionFailedPayload = z.infer<typeof ExtractionFailedPayloadSchema>

// ── ingest.file.clean ─────────────────────────────────────────────────────────

export const FileCleanPayloadSchema = z
  .object({
    fileId: uuidSchema,
    projectId: uuidSchema,
    storageKey: z.string().min(1),
    scanReport: z.object({
      verdict: z.literal('clean'),
      disarmed: z.boolean(),
    }),
  })
  .strict()

export type FileCleanPayload = z.infer<typeof FileCleanPayloadSchema>

// ── ingest.file.quarantined ───────────────────────────────────────────────────

export const FileQuarantinedPayloadSchema = z
  .object({
    fileId: uuidSchema,
    projectId: uuidSchema,
    reason: z.string().min(1),
    threatName: z.string().optional(),
  })
  .strict()

export type FileQuarantinedPayload = z.infer<typeof FileQuarantinedPayloadSchema>

// ── ingest.file.failed ────────────────────────────────────────────────────────

export const FileFailedPayloadSchema = z
  .object({
    fileId: uuidSchema,
    projectId: uuidSchema,
    reason: z.string().min(1),
  })
  .strict()

export type FileFailedPayload = z.infer<typeof FileFailedPayloadSchema>
