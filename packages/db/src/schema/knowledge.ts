import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core'
import { projects } from './identity.js'
import { files } from './files.js'

// -------------------------------------------------------------------------
// VECTOR custom type — wraps pgvector vector(1536)
// -------------------------------------------------------------------------
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)'
  },
  fromDriver(value: string): number[] {
    // Postgres driver returns '[0.1,0.2,...]' string
    return JSON.parse(value.replace(/^\[/, '[').replace(/\]$/, ']')) as number[]
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`
  },
})

// -------------------------------------------------------------------------
// KNOWLEDGE_SOURCES
// -------------------------------------------------------------------------
export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    config: jsonb('config').notNull().default({}),
    credentialRef: text('credential_ref'),
    syncSchedule: text('sync_schedule'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSyncStatus: text('last_sync_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_knowledge_sources_project_id').on(t.projectId)],
)

// -------------------------------------------------------------------------
// INGESTION_JOBS
// -------------------------------------------------------------------------
export const ingestionJobs = pgTable(
  'ingestion_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
    sourceId: uuid('source_id').references(() => knowledgeSources.id, { onDelete: 'set null' }),
    noteId: uuid('note_id'),
    status: text('status').notNull().default('queued'),
    stats: jsonb('stats'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_ingestion_jobs_project_id').on(t.projectId),
    index('idx_ingestion_jobs_file_id').on(t.fileId),
    index('idx_ingestion_jobs_status').on(t.status),
  ],
)

// -------------------------------------------------------------------------
// KNOWLEDGE_CHUNKS  (vector store)
// -------------------------------------------------------------------------
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    origin: text('origin').notNull(),
    originId: uuid('origin_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    headingTrail: text('heading_trail').array().notNull().default([]),
    content: text('content').notNull(),
    // content_tsv is a GENERATED column — not declared in Drizzle (read-only from DB side)
    embedding: vector('embedding'),
    tokenCount: integer('token_count').notNull(),
    stale: boolean('stale').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_knowledge_chunks_project_origin').on(t.projectId, t.origin),
    index('idx_knowledge_chunks_origin_id').on(t.originId, t.chunkIndex),
    uniqueIndex('knowledge_chunks_origin_origin_id_chunk_index_unique').on(
      t.origin,
      t.originId,
      t.chunkIndex,
    ),
  ],
)
