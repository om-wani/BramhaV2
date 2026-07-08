import { z } from 'zod'
import { uuidSchema, isoDateSchema } from './common.js'

// ── KnowledgeSource ───────────────────────────────────────────────────────────

export const KnowledgeSourceTypeSchema = z.enum([
  'github_repo',
  'gitlab_repo',
  'sql_database',
  'url',
  'manual',
])
export type KnowledgeSourceType = z.infer<typeof KnowledgeSourceTypeSchema>

export const KnowledgeSourceSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    type: KnowledgeSourceTypeSchema,
    config: z.record(z.string(), z.unknown()),
    credentialRef: z.string().nullable(),
    syncSchedule: z.string().nullable(),
    lastSyncAt: isoDateSchema.nullable(),
    lastSyncStatus: z.string().nullable(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict()

export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>

// ── IngestionJob ──────────────────────────────────────────────────────────────

export const IngestionJobKindSchema = z.enum(['file', 'source_sync', 'note_delta'])
export type IngestionJobKind = z.infer<typeof IngestionJobKindSchema>

export const IngestionJobStatusSchema = z.enum([
  'queued',
  'security_gate',
  'extracting',
  'chunking',
  'embedding',
  'done',
  'failed',
  'quarantined',
])
export type IngestionJobStatus = z.infer<typeof IngestionJobStatusSchema>

export const IngestionJobSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    kind: IngestionJobKindSchema,
    fileId: uuidSchema.nullable(),
    sourceId: uuidSchema.nullable(),
    noteId: uuidSchema.nullable(),
    status: IngestionJobStatusSchema,
    stats: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().nullable(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict()

export type IngestionJob = z.infer<typeof IngestionJobSchema>

// ── KnowledgeChunk ────────────────────────────────────────────────────────────

export const KnowledgeChunkOriginSchema = z.enum([
  'upload',
  'source',
  'ceo_office',
  'conversation_summary',
  'artifact',
])
export type KnowledgeChunkOrigin = z.infer<typeof KnowledgeChunkOriginSchema>

export const KnowledgeChunkSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    origin: KnowledgeChunkOriginSchema,
    originId: uuidSchema,
    chunkIndex: z.number().int().nonnegative(),
    headingTrail: z.array(z.string()),
    content: z.string().min(1),
    tokenCount: z.number().int().positive(),
    stale: z.boolean(),
    createdAt: isoDateSchema,
  })
  .strict()

export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>
