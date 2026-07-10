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

// ── Search ────────────────────────────────────────────────────────────────────

export const SearchKnowledgeInputSchema = z
  .object({
    query: z.string().max(2048),
    origins: z
      .array(
        z.enum(['upload', 'source', 'ceo_office', 'conversation_summary', 'artifact']),
      )
      .optional(),
    limit: z.number().int().min(1).max(20).optional().default(10),
  })
  .strict()

export type SearchKnowledgeInput = z.infer<typeof SearchKnowledgeInputSchema>

export const KnowledgeSearchResultItemSchema = z
  .object({
    chunkId: z.string().uuid(),
    origin: z.enum(['upload', 'source', 'ceo_office', 'conversation_summary', 'artifact']),
    originId: z.string().uuid(),
    chunkIndex: z.number().int(),
    headingTrail: z.array(z.string()),
    snippet: z.string(),
    score: z.number(),
  })
  .strict()

export type KnowledgeSearchResultItem = z.infer<typeof KnowledgeSearchResultItemSchema>

export const KnowledgeSearchResultSchema = z
  .object({
    items: z.array(KnowledgeSearchResultItemSchema),
    query: z.string(),
    lexicalCount: z.number().int(),
    vectorCount: z.number().int(),
    durationMs: z.number(),
  })
  .strict()

export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResultSchema>

// ── Source Connector Schemas ───────────────────────────────────────────────────

export const CreateSourceInputSchema = z.object({
  type: z.enum(['github_repo', 'gitlab_repo', 'sql_database', 'url']),
  config: z.object({
    // github_repo / gitlab_repo: repoUrl, branch
    repoUrl: z.string().url().optional(),
    branch: z.string().optional(),
    // sql_database: host, port, database, username
    host: z.string().optional(),
    port: z.number().int().optional(),
    database: z.string().optional(),
    username: z.string().optional(),
    // url: rootUrl, maxDepth, maxPages
    rootUrl: z.string().url().optional(),
    maxDepth: z.number().int().min(1).max(3).optional(),
    maxPages: z.number().int().min(1).max(200).optional(),
  }),
  credential: z.string().optional(),
  syncSchedule: z.string().optional(),
})

export type CreateSourceInput = z.infer<typeof CreateSourceInputSchema>

export const SourceResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  type: z.string(),
  config: z.record(z.string(), z.unknown()),
  hasCredential: z.boolean(),
  syncSchedule: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  lastSyncStatus: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type SourceResponse = z.infer<typeof SourceResponseSchema>

export const SourceHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid().nullable(),
  status: z.string(),
  stats: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type SourceHistoryEntry = z.infer<typeof SourceHistoryEntrySchema>

export const SyncSourceJobDataSchema = z.object({
  projectId: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceType: z.enum(['github_repo', 'gitlab_repo', 'sql_database', 'url']),
  config: z.record(z.string(), z.unknown()),
  credentialRef: z.string().nullable(),
  triggeredBy: z.string().uuid(),
})

export type SyncSourceJobData = z.infer<typeof SyncSourceJobDataSchema>
