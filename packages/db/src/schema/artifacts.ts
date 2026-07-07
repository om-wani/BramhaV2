import { pgTable, uuid, text, integer, timestamp, primaryKey, index } from 'drizzle-orm/pg-core'
import { projects, users } from './identity.js'
import { conversations, conversationNodes } from './conversations.js'

// -------------------------------------------------------------------------
// ARTIFACTS  (metadata only — content lives in S3/MinIO)
// -------------------------------------------------------------------------
export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    // created_by_persona: no FK — agent_personas table does not exist until Phase 3
    createdByPersona: uuid('created_by_persona'),
    createdByUser: uuid('created_by_user').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    currentVersion: integer('current_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_artifacts_project_id').on(t.projectId),
    index('idx_artifacts_conversation_id').on(t.conversationId),
  ],
)

// -------------------------------------------------------------------------
// ARTIFACT_VERSIONS  (immutable — one row per version; content in S3)
// -------------------------------------------------------------------------
export const artifactVersions = pgTable(
  'artifact_versions',
  {
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    // S3/MinIO key, e.g. artifacts/{projectId}/{artifactId}/v{version}
    contentKey: text('content_key').notNull(),
    // hex SHA-256 of raw content bytes
    contentSha256: text('content_sha256').notNull(),
    // 2 MB cap — enforced in migration CHECK and at app layer
    sizeBytes: integer('size_bytes').notNull(),
    // nullable: set when created by the agent runtime
    createdByNode: uuid('created_by_node').references(() => conversationNodes.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.artifactId, t.version] })],
)
