import { z } from 'zod'
import { uuidSchema } from '../schemas/common.js'

// Audit events
export const AuditEventSchema = z
  .object({
    eventType: z.string(),
    actorId: uuidSchema.nullable(),
    targetId: uuidSchema.nullable(),
    targetType: z.string().nullable(),
    projectId: uuidSchema.nullable(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict()

export type AuditEvent = z.infer<typeof AuditEventSchema>

// Ingest events (Phase 1 subset)
export const IngestFileEventSchema = z
  .object({
    fileId: uuidSchema,
    projectId: uuidSchema,
    userId: uuidSchema,
    s3Key: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().positive(),
    enqueuedAt: z.string().datetime({ offset: true }),
  })
  .strict()

export type IngestFileEvent = z.infer<typeof IngestFileEventSchema>

// Conversation realtime events
export * from './conversations.js'
